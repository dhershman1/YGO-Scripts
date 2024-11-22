# YGO-Scripts

These are my custom node scripts to move data from https://ygoprodeck.com API into my own database

You'll need a database, and S3 Bucket ready to go, populate your .env file with the following variabels:

```
DB_PASSWORD=
DB_USER=
DB_NAME=
DB_HOST=
DB_PORT=
NODE_ENV=
S3_BUCKET=
AWS_REGION=
```

> [!Note]
> You can replace the DB keys with a DATABASE_URL key instead if that's your preferred method!

Now run:

```cli
npm i
```

> [!important]
> Make sure you change the table names in the scripts to match your tables!

and you should be good to run the scripts.

You can use `npm start` to run all of the scripts (besides the image transfer one) at the same time
You can also use `npm run no-binders` so you run both the other scripts without the binders one

## Card Migration

This scripts job is to take the cards from the api request https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes and transfer the data into my own Database

### Usage

```cli
npm run cards
```

## Image Upload

This script will take the longest out of all of them, it runs in batches of 19 calls per second. This is because ygoprodeck limits how many calls you can make per second (including images)

It will take all the card images (besides cropped) from the api request and upload them to the desired S3 bucket.

It follows these S3 keys:

`cards/normal/{card_id}.jpg`
`cards/small/{card_id}.jpg`

Make sure your S3 is setup locally to have access rights to your AWS console!

### Usage

```cli
npm run images
```

## Insert Binder and Avatars

This is a script you probably don't care much for, but it takes some strings, and puts them into the DB for me
These strings are S3 keys to mark them back to some custom artwork I've had made for this application.

### Usage

```cli
npm run binders
```

## Tag Gen

This script Generates tags based on archetype and some custom ones I have made, there are over 550+ archetypes that get generated into tags

This script has a safeguard to not insert duplicate tags of the same title

### Usage

```cli
npm run tags
```
