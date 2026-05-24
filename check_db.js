const mongoose = require('mongoose');
require('dotenv').config();
const Notification = require('./src/models/Notification');

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const total = await Notification.countDocuments();
  const today = new Date();
  today.setHours(0,0,0,0);
  const countToday = await Notification.countDocuments({ timestamp: { $gte: today } });
  const latest = await Notification.findOne().sort({ timestamp: -1 });
  
  console.log('Total Notifications:', total);
  console.log('Notifications Today:', countToday);
  console.log('Latest Notification Timestamp:', latest ? latest.timestamp : 'None');
  console.log('User IDs in DB:', await Notification.distinct('userId'));
  
  process.exit(0);
}
check();
