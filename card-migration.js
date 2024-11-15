import axios from 'axios'
import knex from 'knex'
import cliProgress from 'cli-progress'
import 'dotenv/config'

const ANALYTICS = {
  total: 0,
  processed: 0,
  errors: 0
}
// Remove the cardset when we want to run this against ALL the cards
const DBO_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes'
let db = null

if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') {
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

function printAnalytics () {
  console.log(`
    Total: ${ANALYTICS.total}
    Processed: ${ANALYTICS.processed}
    Errors: ${ANALYTICS.errors}
  `)
}

async function shouldRun () {
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

async function fetchCards () {
  console.log('Fetching Cards...')
  const { data } = await axios.get(DBO_URL)
  return data.data
}

async function copyCards () {
  console.log('Copying Cards...')

  const needsUpdate = await shouldRun()

  if (!needsUpdate) {
    console.log('No new data to fetch...')
    await db.destroy()
    return
  }

  const data = await fetchCards()

  const bar = new cliProgress.SingleBar({
    format: '{bar} | {filename} | {value}/{total}'
  }, cliProgress.Presets.shades_classic)
  ANALYTICS.total = data.length
  bar.start(data.length)
  try {
    for (const card of data) {
      try {
        const cardImages = card.card_images.map(({ id }) => id)
        await db('cards')
          .insert({
            id: card.id,
            name: card.name,
            type: card.type,
            description: card.desc,
            frame_type: card.frameType,
            attack: card.atk,
            defense: card.def,
            level: card.level,
            typeline: card.typeline,
            attribute: card.attribute,
            archetype: card.archetype,
            race: card.race,
            card_sets: card.card_sets,
            formats: card.misc_info[0].formats,
            konami_id: card.misc_info[0].konami_id,
            card_prices: card.card_prices,
            card_images: cardImages,
            banlist_info: card.banlist_info
          })
          .onConflict('id')
          .merge()
        ANALYTICS.processed++
      } catch (e) {
        ANALYTICS.errors++
        console.log('====================================')
        console.error(e)
      } finally {
        bar.increment({ filename: card.name })
      }
    }
  } finally {
    try {
      await db.destroy()
    } catch (e) {
      console.error('Error closing connection', e)
    }
    bar.stop()
    printAnalytics()
  }
}

copyCards()
