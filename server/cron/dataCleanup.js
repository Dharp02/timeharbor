// server/cron/dataCleanup.js

import { Meteor } from 'meteor/meteor';
import { ActivityData, ActivitySummary } from '../../imports/api/collections.js';

// Run cleanup daily at 2 AM
const cleanupJob = Meteor.setInterval(() => {
  const now = new Date();
  
  // Only run at 2 AM
  if (now.getHours() !== 2) return;
  
  console.log('Running ActivityWatch data cleanup...');
  
  runCleanup();
}, 60 * 60 * 1000); // Check every hour

async function runCleanup() {
  try {
    // Delete raw data older than 7 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    
    const result = await ActivityData.removeAsync({
      createdAt: { $lt: cutoffDate },
      aggregated: true
    });
    
    console.log(`Cleaned up ${result} old activity records`);
    
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// Export for manual trigger
export { runCleanup };