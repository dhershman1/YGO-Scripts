import knex from 'knex'
import axios from 'axios'
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

// Were gonna use the archetypes to generate tags
async function fetchAcrhetypes () {
  console.log('Fetching Archetypes...')
  const { data } = await axios.get('https://db.ygoprodeck.com/api/v7/archetypes.php')

  return data
}

async function generateTags () {
  console.log('Generating Tags...')
  const normalTags = [
    'Interruption',
    'Monster',
    'Spell',
    'Trap',
    'Effect',
    'Normal',
    'Fusion',
    'Ritual',
    'Synchro',
    'Xyz',
    'Pendulum',
    'Link',
    'Continuous',
    'Counter',
    'Quick-Play',
    'Equip',
    'Field'
  ]
  const archetypes = new Set([...normalTags, ...(await fetchAcrhetypes()).map(({ archetype_name: archetypeName }) => archetypeName)])
  const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
  bar.start(archetypes.size, 0)

  for (const archetype of archetypes) {
    const existingTag = await db('tags').where({ title: archetype }).first()
    if (!existingTag) {
      await db('tags').insert({
        title: archetype
      })
    }
    bar.increment()
  }

  bar.stop()
  await db.destroy()
}

generateTags()
