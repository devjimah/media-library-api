// Jest global test setup — spins up an in-memory MongoDB for the whole test run,
// connects Mongoose to it, clears collections between tests, and tears everything
// down at the end. Ensures tests never touch development or Atlas data.

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Force a test environment before anything reads process.env.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
process.env.MAX_FILE_SIZE_MB = process.env.MAX_FILE_SIZE_MB || '5';

let mongo: MongoMemoryServer;

// What: Boots the in-memory database once before any test runs.
// Does: Starts MongoMemoryServer, sets MONGODB_URI to its URI, and connects Mongoose.
// If removed: Model calls have no database and every test throws a connection error.
beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const uri = mongo.getUri();
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_ATLAS_URI = '';
    await mongoose.connect(uri);
});

// What: Resets database state between individual tests.
// Does: Deletes all documents from every collection after each test.
// If removed: Tests leak data into each other and assertions become order-dependent.
afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
        await collections[key].deleteMany({});
    }
});

// What: Tears the in-memory database down after the whole suite finishes.
// Does: Disconnects Mongoose and stops the MongoMemoryServer process.
// If removed: Jest hangs open on the live connection and the mongod child process leaks.
afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});
