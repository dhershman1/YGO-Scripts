import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import knex from 'knex'
import cliProgress from 'cli-progress'
import 'dotenv/config'

const REGION = process.env.AWS_REGION
const BATCH_SIZE = 19
const BUCKET = process.env.S3_BUCKET
const ANALYTICS = {
  total: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  failedImages: []
}

const s3 = new S3Client({ region: REGION })

let db = null

if (process.env.DATABASE_URL) {
  db = knex({
    client: 'pg',
    connection: process.env.DATABASE_URL,
    searchPath: ['public']
  })
} else {
  db = knex({
    client: 'pg',
    searchPath: ['public'],
    connection: {
      port: process.env.DB_PORT,
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD
    }
  })
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function printAnalytics () {
  console.log('Analytics:')
  console.log('Failed images list:', ANALYTICS.failedImages)
  console.log('Total images:', ANALYTICS.total)
  console.log('Processed images:', ANALYTICS.processed)
  console.log('Skipped images:', ANALYTICS.skipped)
  console.log('Failed images:', ANALYTICS.failed)
}

async function fetchImageUrls (apiEndpoint) {
  try {
    console.log('Fetching image URLs...')
    const response = await axios.get(apiEndpoint)
    const imgMap = new Map()

    for (const { card_images: cardImgs } of response.data.data) {
      for (const cImg of cardImgs) {
        imgMap.set(
          cImg.id,
          new Map([
            ['normal', cImg.image_url],
            ['small', cImg.image_url_small]
          ])
        )
      }
    }

    return imgMap
  } catch (error) {
    console.error(error)
    return []
  }
}

async function downloadImage (url, destination) {
  const writer = fs.createWriteStream(destination)

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  })

  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

async function uploadToS3 (filePath, bucketName, key) {
  const fileContent = fs.readFileSync(filePath)
  const params = {
    Bucket: bucketName,
    Key: key,
    Body: fileContent,
    ContentType: 'image/jpeg'
  }

  const command = new PutObjectCommand(params)
  return s3.send(command)
}

async function checkS3FileExists (bucketName, key) {
  const command = new HeadObjectCommand({ Bucket: bucketName, Key: key })

  try {
    await s3.send(command)
    return true // File exists
  } catch (error) {
    if (error.name === 'NotFound') {
      return false // File does not exist
    }
    throw error // Some other error occurred
  }
}

async function throttleDownload (downloadTasks) {
  for (let i = 0; i < downloadTasks.length; i += BATCH_SIZE) {
    const batch = downloadTasks.slice(i, i + BATCH_SIZE)

    try {
      const results = await Promise.all(batch.map((task) => task()))
      const allSkipped = results.every((skipped) => skipped)

      if (!allSkipped) {
        await sleep(1000) // Wait 1 second between batches if not all images were skipped
      }
    } catch (err) {
      console.error('Something went wrong while processing the batch:')
      console.error(batch)
      console.error(err)
    }
  }
}

async function shouldRun () {
  console.log('Checking DB Versions...')
  const { data } = await axios.get('https://db.ygoprodeck.com/api/v7/checkDBVer.php')
  const [ygoDb] = data
  const myDB = db('db_info')
  const dbInfo = await myDB.select('*').orderBy('downloaded_version', 'desc').first()

  if (!dbInfo) {
    // Insert a new record with the current version
    await myDB.insert({
      downloaded_version: ygoDb.database_version,
      last_updated: new Date().toISOString()
    })

    return true
  }

  if (dbInfo.downloaded_version !== ygoDb.database_version) {
    // Update the record with the new version
    await myDB
      .update({
        downloaded_version: ygoDb.database_version,
        last_updated: new Date().toISOString()
      })
      .catch(async (error) => {
        if (error.message.includes('No rows were updated')) {
          await myDB.insert({
            downloaded_version: ygoDb.database_version,
            last_updated: new Date().toISOString()
          })
        } else {
          throw error
        }
      })
    return true
  }

  return false
}

async function generateFolders () {
  console.log('Generating folders...')
  const folders = ['images', 'images/normal', 'images/small', 'images/cropped']
  for (const folder of folders) {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true })
    }
  }
}

async function rehostImages (apiEndpoint, bucketName) {
  console.log('Starting image rehosting process...')
  const needsUpdate = await shouldRun()

  if (!needsUpdate) {
    console.log('No new data to fetch...')
    await db.destroy()
    return
  }

  await generateFolders()

  const imageUrls = await fetchImageUrls(apiEndpoint)
  const totalImages = [...imageUrls.values()].reduce((acc, imgMap) => acc + imgMap.size, 0)

  console.info('Total images to process:', totalImages)

  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
  progressBar.start(totalImages, 0)

  let processedImages = 0
  const downloadTasks = []

  for (const [, imgMap] of imageUrls) {
    for (const [loc, url] of imgMap) {
      if (!url) continue

      const fileName = path.basename(url)
      const s3Key = `cards/${loc}/${fileName}`

      const task = async () => {
        try {
          const exists = await checkS3FileExists(bucketName, s3Key)
          if (exists) {
            ANALYTICS.skipped++
            return true
          } else {
            const localPath = path.join('images', loc, fileName)
            await downloadImage(url, localPath)
            await uploadToS3(localPath, bucketName, s3Key)
            fs.unlinkSync(localPath)
            ANALYTICS.processed++
            return false
          }
        } catch (err) {
          console.error(err)
          console.error('Something went wrong!')
          console.error(`Failed to process image: ${url}`)
          ANALYTICS.failedImages.push(url)
          ANALYTICS.failed++
          return false
        } finally {
          ANALYTICS.total++
          processedImages++
          progressBar.update(processedImages)
        }
      }

      downloadTasks.push(task)
    }
  }

  await throttleDownload(downloadTasks)

  progressBar.stop()
  console.log('All images have been processed and uploaded to S3.')
  printAnalytics()
}

rehostImages('https://db.ygoprodeck.com/api/v7/cardinfo.php', BUCKET)
