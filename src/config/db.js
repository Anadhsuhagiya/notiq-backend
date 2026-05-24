const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  const conn = await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: process.env.NODE_ENV !== 'production',
  });
  logger.info(`MongoDB Connected: ${conn.connection.host}`);
  return conn;
};

module.exports = connectDB;
