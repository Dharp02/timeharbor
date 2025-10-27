import { Meteor } from 'meteor/meteor';
import { ActivityData, ActivitySummary } from '../../imports/api/collections.js';

// Run cleanup every day at 2 AM
if (Meteor.isServer) {
  const cleanupInterval = Meteor.setInterval(() => {
    const now = new Date();
    
    // Only run at 2 AM
    if (now.getHours() === 2 && now.getMinutes() < 10) {
      runDailyCleanup();
    }
  }, 10 * 60 * 1000); // Check every 10 minutes
}

async function runDailyCleanup() {
  console.log('🧹 Starting ActivityWatch data cleanup...');
  
  try {
    // Delete raw activity data older than 7 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    
    const result = await ActivityData.removeAsync({
      createdAt: { $lt: cutoffDate }
    });
    
    console.log(`✅ Deleted ${result} old activity records`);
    
    // Delete old summaries (older than 6 months)
    const summariesCutoff = new Date();
    summariesCutoff.setMonth(summariesCutoff.getMonth() - 6);
    
    const summariesResult = await ActivitySummary.removeAsync({
      createdAt: { $lt: summariesCutoff },
      sharedWithManager: false // Keep shared ones
    });
    
    console.log(`✅ Deleted ${summariesResult} old unshared summaries`);
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  }
}

// Export for manual trigger
export { runDailyCleanup };