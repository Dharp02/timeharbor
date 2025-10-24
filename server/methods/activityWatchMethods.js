// imports/api/methods/activityWatchMethods.js

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ActivityData, ActivitySummary, PrivacySettings, Teams } from '../../collections.js';
import axios from 'axios';

export const activityWatchMethods = {

    async 'activityWatch.testQueryOnly'(startDate, endDate) {
    check(startDate, String);
    check(endDate, String);
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    try {
      const bucketsRes = await axios.get('http://localhost:5600/api/0/buckets');
      const buckets = Object.keys(bucketsRes.data);
      const windowBucket = buckets.find(b => b.includes('aw-watcher-window'));
      
      if (!windowBucket) {
        return { success: false, error: 'No window bucket found', buckets };
      }
      
      const query = {
        timeperiods: [`${startDate}T00:00:00/${endDate}T23:59:59`],
        query: [
          `events = query_bucket("${windowBucket}");`,
          `RETURN = events;`
        ]
      };
      
      console.log('Testing query:', JSON.stringify(query, null, 2));
      
      const response = await axios.post(
        'http://localhost:5600/api/0/query',
        query,
        { timeout: 10000 }
      );
      
      return {
        success: true,
        api: 'query',
        bucketUsed: windowBucket,
        eventsCount: response.data[0]?.length || 0,
        sampleEvent: response.data[0]?.[0] || null
      };
      
    } catch (error) {
      return {
        success: false,
        api: 'query',
        error: error.message,
        status: error.response?.status,
        responseData: error.response?.data
      };
    }
  },
  
  async 'activityWatch.testDirectOnly'(startDate, endDate) {
    check(startDate, String);
    check(endDate, String);
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    try {
      const bucketsRes = await axios.get('http://localhost:5600/api/0/buckets');
      const buckets = Object.keys(bucketsRes.data);
      
      let totalEvents = 0;
      const bucketResults = {};
      
      for (const bucketId of buckets) {
        if (bucketId.includes('afk')) continue;
        
        try {
          const events = await axios.get(
            `http://localhost:5600/api/0/buckets/${bucketId}/events`,
            {
              params: {
                start: `${startDate}T00:00:00`,
                end: `${endDate}T23:59:59`,
                limit: 10000
              }
            }
          );
          
          bucketResults[bucketId] = events.data.length;
          totalEvents += events.data.length;
          
        } catch (err) {
          bucketResults[bucketId] = `Error: ${err.message}`;
        }
      }
      
      return {
        success: true,
        api: 'direct',
        totalEvents,
        bucketResults
      };
      
    } catch (error) {
      return {
        success: false,
        api: 'direct',
        error: error.message
      };
    }
},
  
  









  
  /**
   * Fetch and process ActivityWatch data
   */
  async 'activityWatch.generateReport'(startDate, endDate) {
    check(startDate, String);
    check(endDate, String);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    try {
      // 1. Fetch data from ActivityWatch (user's local instance)
      const rawData = await fetchFromActivityWatch(startDate, endDate);
      
      // 2. Get user's team privacy settings
      const userTeams = await Teams.find({ 
        members: this.userId 
      }).fetchAsync();
      
      const teamId = userTeams[0]?._id;
      const privacySettings = await PrivacySettings.findOneAsync({ 
        teamId 
      }) || getDefaultPrivacySettings();
      
      // 3. Process and filter data based on privacy
      const processed = processActivityData(rawData, privacySettings);
      
      // 4. Store in MongoDB
      await storeActivityData(this.userId, processed);
      
      // 5. Generate summary
      const summary = generateSummary(processed, privacySettings);
      
      // 6. Store summary
      const summaryId = await ActivitySummary.insertAsync({
        userId: this.userId,
        teamId,
        weekStart: startDate,
        summaryData: summary,
        privacyLevel: privacySettings.privacyLevel,
        sharedWithManager: false,
        createdAt: new Date()
      });
      
      return {
        success: true,
        summary,
        summaryId
      };
      
    } catch (error) {
      console.error('ActivityWatch report generation failed:', error);
      throw new Meteor.Error('report-failed', error.message);
    }
  },
  
  /**
   * Share summary with manager
   */
  async 'activityWatch.shareSummary'(summaryId) {
    check(summaryId, String);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    const summary = await ActivitySummary.findOneAsync({
      _id: summaryId,
      userId: this.userId
    });
    
    if (!summary) {
      throw new Meteor.Error('not-found', 'Summary not found');
    }
    
    // Mark as shared
    await ActivitySummary.updateAsync(summaryId, {
      $set: { 
        sharedWithManager: true,
        sharedAt: new Date()
      }
    });
    
    // Notify team admins/leaders
    const team = await Teams.findOneAsync(summary.teamId);
    const user = await Meteor.users.findOneAsync(this.userId);
    const userName = user?.profile?.name || user?.username || 'A team member';
    
    try {
      await notifyTeamAdmins(summary.teamId, {
        title: 'Time Harbor - Activity Report',
        body: `${userName} shared their weekly activity report`,
        icon: '/timeharbor-icon.svg',
        data: {
          type: 'activity-report-shared',
          userId: this.userId,
          summaryId,
          url: '/admin/activity-reports'
        }
      });
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
    
    return { success: true };
  },
  
  /**
   * Get user's activity reports (for their own view)
   */
  async 'activityWatch.getMyReports'(limit = 10) {
    check(limit, Number);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    const reports = await ActivitySummary.find({
      userId: this.userId
    }, {
      sort: { createdAt: -1 },
      limit
    }).fetchAsync();
    
    return reports;
  },
  
  /**
   * Get team activity reports (manager view)
   */
  async 'activityWatch.getTeamReports'(teamId, startDate, endDate) {
    check(teamId, String);
    check(startDate, String);
    check(endDate, String);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    // Check if user is team admin/leader
    const team = await Teams.findOneAsync(teamId);
    const isAdmin = team?.admins?.includes(this.userId) || 
                    team?.leader === this.userId;
    
    if (!isAdmin) {
      throw new Meteor.Error('not-authorized', 'Only team admins can view reports');
    }
    
    // Get all shared reports from team members
    const reports = await ActivitySummary.find({
      teamId,
      sharedWithManager: true,
      createdAt: { 
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    }).fetchAsync();
    
    // Enrich with user data
    const enriched = await Promise.all(reports.map(async (report) => {
      const user = await Meteor.users.findOneAsync(report.userId);
      return {
        ...report,
        userName: user?.profile?.name || user?.username || 'Unknown',
        userEmail: user?.emails?.[0]?.address
      };
    }));
    
    return enriched;
  },




  

















  
  /**
   * Update team privacy settings (admin only)
   */
  async 'activityWatch.updatePrivacySettings'(teamId, settings) {
    check(teamId, String);
    check(settings, Object);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    // Check if user is team admin
    const team = await Teams.findOneAsync(teamId);
    const isAdmin = team?.admins?.includes(this.userId) || 
                    team?.leader === this.userId;
    
    if (!isAdmin) {
      throw new Meteor.Error('not-authorized', 'Only admins can update settings');
    }
    
    // Validate privacy level
    if (![1, 2, 3].includes(settings.privacyLevel)) {
      throw new Meteor.Error('invalid-input', 'Privacy level must be 1, 2, or 3');
    }
    
    await PrivacySettings.upsertAsync(
      { teamId },
      {
        $set: {
          ...settings,
          updatedAt: new Date(),
          updatedBy: this.userId
        }
      }
    );
    
    return { success: true };
  },
  
  /**
   * Check if ActivityWatch is running
   */
  async 'activityWatch.checkConnection'() {
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    try {
      const response = await axios.get('http://localhost:5600/api/0/buckets', {
        timeout: 3000
      });
      
      return { 
        connected: true,
        buckets: Object.keys(response.data).length
      };
    } catch (error) {
      return { 
        connected: false,
        error: 'ActivityWatch not running. Please start ActivityWatch.'
      };
    }
  }
};

// Helper functions (server-side only)

async function fetchFromActivityWatch(startDate, endDate) {

    try {
    // Try query API with proper syntax
    const bucketsRes = await axios.get('http://localhost:5600/api/0/buckets');
    const buckets = Object.keys(bucketsRes.data);
    const windowBucket = buckets.find(b => b.includes('aw-watcher-window'));
    
    if (!windowBucket) throw new Error('No bucket found');
    
    // Try query API
    const query = {
      timeperiods: [`${startDate}T00:00:00/${endDate}T23:59:59`],
      query: [
        `events = query_bucket("${windowBucket}");`,
        `RETURN = events;`
      ]
    };
    
    const response = await axios.post(
      'http://localhost:5600/api/0/query',
      query,
      { timeout: 10000 }
    );
    
    console.log('✅ Using query API');
    return response.data[0] || [];
    
  } catch (error) {
    // Fallback to direct API (what's working)
    console.log('⚠️ Query API failed, using direct API');
    return await fetchFromActivityWatchDirect(startDate, endDate);
  }
}

// Keep your working direct API as fallback
async function fetchFromActivityWatchDirect(startDate, endDate) {
  const bucketsRes = await axios.get('http://localhost:5600/api/0/buckets');
  const buckets = Object.keys(bucketsRes.data);
  
  const allEvents = [];
  for (const bucketId of buckets) {
    if (bucketId.includes('afk')) continue;
    
    try {
      const events = await axios.get(
        `http://localhost:5600/api/0/buckets/${bucketId}/events`,
        {
          params: {
            start: `${startDate}T00:00:00`,
            end: `${endDate}T23:59:59`,
            limit: 10000
          }
        }
      );
      allEvents.push(...events.data);
    } catch (err) {
      console.log(`Skipping ${bucketId}`);
    }
  }
  
  return allEvents;
}






function processActivityData(rawData, privacySettings) {
  return rawData.map(event => ({
    app: event.data?.app || 'Unknown',
    url: event.data?.url || null,
    domain: extractDomain(event.data?.url),
    title: event.data?.title || null,
    duration: event.duration || 0,
    timestamp: new Date(event.timestamp),
    category: categorizeApp(event.data?.app)
  }));
}

function categorizeApp(appName) {
  const mapping = {
    'Code.exe': 'development',
    'Visual Studio Code': 'development',
    'Terminal': 'development',
    'iTerm': 'development',
    'Slack': 'communication',
    'Chrome': 'web',
    'Firefox': 'web'
  };
  return mapping[appName] || 'other';
}

function extractDomain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function generateSummary(processedData, privacySettings) {
  // Apply privacy filtering based on settings
  const level = privacySettings.privacyLevel || 1;
  
  if (level === 1) {
    // Categories only
    return generateCategorySummary(processedData);
  } else if (level === 2) {
    // Apps but no URLs
    return generateAppSummary(processedData);
  } else {
    // Full details with domain filtering
    return generateDetailedSummary(processedData, privacySettings);
  }
}

function generateCategorySummary(data) {
  const categories = {};
  let totalDuration = 0;
  
  data.forEach(activity => {
    const cat = activity.category;
    if (!categories[cat]) categories[cat] = 0;
    categories[cat] += activity.duration;
    totalDuration += activity.duration;
  });
  
  return {
    type: 'categories',
    categories: Object.entries(categories).map(([name, duration]) => ({
      name,
      hours: (duration / 3600).toFixed(2),
      percentage: ((duration / totalDuration) * 100).toFixed(1)
    })),
    totalHours: (totalDuration / 3600).toFixed(2)
  };
}

function generateAppSummary(data) {
  const apps = {};
  let totalDuration = 0;
  
  data.forEach(activity => {
    const app = activity.app;
    if (!apps[app]) {
      apps[app] = { duration: 0, category: activity.category };
    }
    apps[app].duration += activity.duration;
    totalDuration += activity.duration;
  });
  
  return {
    type: 'apps',
    apps: Object.entries(apps)
      .map(([name, data]) => ({
        name,
        hours: (data.duration / 3600).toFixed(2),
        category: data.category
      }))
      .sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours)),
    totalHours: (totalDuration / 3600).toFixed(2)
  };
}

function generateDetailedSummary(data, privacySettings) {
  const workDomains = privacySettings.workRelatedDomains || [];
  const blockedDomains = privacySettings.blockedDomains || [];
  
  const workActivities = [];
  let otherDuration = 0;
  let totalDuration = 0;
  
  data.forEach(activity => {
    totalDuration += activity.duration;
    
    if (activity.domain) {
      // Check if blocked
      if (blockedDomains.includes(activity.domain)) {
        otherDuration += activity.duration;
        return;
      }
      
      // Check if work-related
      const isWork = workDomains.some(d => 
        activity.domain === d || activity.domain.endsWith(d)
      );
      
      if (isWork) {
        workActivities.push(activity);
      } else {
        otherDuration += activity.duration;
      }
    } else {
      // No domain, include app if not browser
      if (!['Chrome', 'Firefox', 'Safari'].includes(activity.app)) {
        workActivities.push(activity);
      } else {
        otherDuration += activity.duration;
      }
    }
  });
  
  // Group work activities by domain
  const domainBreakdown = {};
  workActivities.forEach(activity => {
    const key = activity.domain || activity.app;
    if (!domainBreakdown[key]) {
      domainBreakdown[key] = { duration: 0, visits: 0, category: activity.category };
    }
    domainBreakdown[key].duration += activity.duration;
    domainBreakdown[key].visits += 1;
  });
  
  return {
    type: 'detailed',
    workActivities: Object.entries(domainBreakdown)
      .map(([name, data]) => ({
        name,
        hours: (data.duration / 3600).toFixed(2),
        visits: data.visits,
        category: data.category
      }))
      .sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours)),
    otherHours: (otherDuration / 3600).toFixed(2),
    totalHours: (totalDuration / 3600).toFixed(2)
  };
}

async function storeActivityData(userId, processedData) {
  // Store raw processed data (will be cleaned up later)
  const batch = processedData.map(activity => ({
    userId,
    ...activity,
    createdAt: new Date(),
    aggregated: false
  }));
  
  // Bulk insert
  if (batch.length > 0) {
    await ActivityData.rawCollection().insertMany(batch);
  }
}

function getDefaultPrivacySettings() {
  return {
    privacyLevel: 1, // Maximum privacy by default
    workRelatedDomains: [],
    blockedDomains: [],
    autoCleanupDays: 7,
    keepSummariesMonths: 6
  };
}