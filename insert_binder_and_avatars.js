import knex from 'knex'
import cliProgress from 'cli-progress'

import 'dotenv/config'

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

const BINDERS = [
  // ['filename', 'artist']
  // TODO: Remove AI Binder when we have a proper artists
  ['binder.webp', 'AI'],
  ['vintage_binder.jpg', 'Elina Shepherd/@elinasheph.bsky.social'],
  ['blue_warp.jpg', 'Ava James/@avajame.bsky.social']
]
const AVATARS = []
const multibar = new cliProgress.MultiBar({
  clearOnComplete: false,
  hideCursor: true,
  format: ' {bar} | {filename} | {value}/{total}'
}, cliProgress.Presets.shades_grey)

const bindersBar = multibar.create(BINDERS.length, 0)
const avatarsBar = multibar.create(AVATARS.length, 0)

const insertBinders = BINDERS.map(async ([filename, artist]) => {
  const existingBinder = await db('binder_images').where({ s3_key: filename }).first()
  if (!existingBinder) {
    await db('binder_images').insert({ s3_key: filename, artist })
  }
  bindersBar.increment({ filename })
})

const insertAvatars = AVATARS.map(async ([filename, artist]) => {
  const existingAvatar = await db('avatars').where({ s3_key: filename }).first()
  if (!existingAvatar) {
    await db('avatars').insert({ filename, artist })
  }
  avatarsBar.increment({ filename })
})

Promise.all([...insertBinders, ...insertAvatars]).then(async () => {
  multibar.stop()
  await db.destroy()
  process.exit(0)
})
