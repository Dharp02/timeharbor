import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ActivityData, ActivitySummary } from '../../collections.js';
import axios from 'axios';

export const activityWatchMethods = {

  async 'activityWatch.debugShowRecords'(appName, limit = 5) {
    check(appName, String);
    check(limit, Number);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    const records = await ActivityData.find({
      userId: this.userId,
      app: appName
    }, { 
      limit,
      sort: { createdAt: -1 }
    }).fetchAsync();
    
    console.log(`Found ${records.length} records for app: ${appName}`);
    
    return records;
  },

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
   * Fetch and process ActivityWatch data - USER VIEW ONLY
   */
  async 'activityWatch.generateReport'(startDate, endDate) {
    check(startDate, String);
    check(endDate, String);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    try {
      // 1. Fetch data from ActivityWatch (user's local instance)
      const rawData = await fetchFromActivityWatch(startDate, endDate);
      
      // 2. Process data
      const processed = processActivityData(rawData);
      
      // 3. Store in MongoDB
      await storeActivityData(this.userId, processed);
      
      // 4. Generate USER'S DETAILED VIEW
      const userSummary = generateUserDetailedSummary(processed);
      
      // 5. Store summary
      const summaryId = await ActivitySummary.insertAsync({
        userId: this.userId,
        weekStart: startDate,
        summaryData: userSummary,
        createdAt: new Date()
      });
      
      return {
        success: true,
        summary: userSummary,
        summaryId
      };
      
    } catch (error) {
      console.error('ActivityWatch report generation failed:', error);
      throw new Meteor.Error('report-failed', error.message);
    }
  },
  
  /**
   * Get user's activity reports
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
  },
  
  /**
   * Delete all activity data for a specific app
   */
  async 'activityWatch.deleteApp'(appName) {
    check(appName, String);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    try {
      const result = await ActivityData.removeAsync({
        userId: this.userId,
        app: appName
      });
      
      console.log(`🗑️ Deleted ${result} activity records for app: ${appName}`);
      
      return { 
        success: true, 
        deletedCount: result 
      };
    } catch (error) {
      console.error('Failed to delete app:', error);
      throw new Meteor.Error('delete-failed', error.message);
    }
  },
  
  /**
   * Delete activity data for a specific website/file
   */
  async 'activityWatch.deleteActivity'(activityName, domain, parentApp) {
    check(activityName, String);
    check(domain, Match.Maybe(String));
    check(parentApp, String);
    
    if (!this.userId) throw new Meteor.Error('not-authorized');
    
    try {
      console.log(`🗑️ Attempting to delete activity:`, {
        activityName,
        domain,
        parentApp,
        userId: this.userId
      });
      
      let query = {
        userId: this.userId,
        app: parentApp
      };
      
      // Strategy 1: If domain is provided and not null, delete by domain
      if (domain && domain !== 'null' && domain !== 'undefined') {
        query.domain = domain;
        console.log(`  Using domain-based deletion: ${domain}`);
      } 
      // Strategy 2: For browsers without domain or for files, match by title
      else {
        query.$or = [
          { title: activityName },
          { title: { $regex: escapeRegex(activityName), $options: 'i' } }
        ];
        console.log(`  Using title-based deletion for: ${activityName}`);
      }
      
      console.log(`  Query:`, JSON.stringify(query, null, 2));
      
      const count = await ActivityData.find(query).countAsync();
      console.log(`  Found ${count} matching records`);
      
      if (count === 0) {
        console.log(`  ⚠️ No records found to delete`);
        return { 
          success: true, 
          deletedCount: 0,
          message: 'No matching records found'
        };
      }
      
      const result = await ActivityData.removeAsync(query);
      
      console.log(`  ✅ Deleted ${result} activity records`);
      
      return { 
        success: true, 
        deletedCount: result 
      };
    } catch (error) {
      console.error('❌ Failed to delete activity:', error);
      throw new Meteor.Error('delete-failed', error.message);
    }
  }
};

// Helper function to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper functions (server-side only)

async function fetchFromActivityWatch(startDate, endDate) {
  try {
    // Try query API with proper syntax
    const bucketsRes = await axios.get('http://localhost:5600/api/0/buckets');
    const buckets = Object.keys(bucketsRes.data);
    const windowBucket = buckets.find(b => b.includes('aw-watcher-window'));
    
    if (!windowBucket) throw new Error('No bucket found');
    
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
    // Fallback to direct API
    console.log('⚠️ Query API failed, using direct API');
    return await fetchFromActivityWatchDirect(startDate, endDate);
  }
}

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

function processActivityData(rawData) {
  console.log(`📥 Processing ${rawData.length} raw activities`);
  
  return rawData.map(event => {
    
    const activity = {
      app: event.data?.app || 'Unknown',
      url: event.data?.url || null,
      domain: extractDomain(event.data?.url),
      title: event.data?.title || null,
      duration: event.duration || 0,
      timestamp: new Date(event.timestamp),
      category: categorizeApp(event.data?.app)
    };
    
    // Log browser activities to debug
    if (activity.app && activity.app.toLowerCase().includes('chrome')) {
      console.log('🌐 Chrome activity:', {
        app: activity.app,
        title: activity.title,
        url: activity.url,
        domain: activity.domain,
        duration: activity.duration
      });
    }
    
    return activity;
  });
}

function categorizeApp(appName) {
  const mapping = {
    'Code.exe': 'development',
    'Visual Studio Code': 'development',
    'code': 'development',
    'Terminal': 'development',
    'iTerm': 'development',
    'Slack': 'communication',
    'Chrome': 'web',
    'Firefox': 'web',
    'Safari': 'web'
  };
  return mapping[appName] || 'other';
}

function extractDomain(url) {
  if (!url) return null;
  
  try {
    // Add protocol if missing
    let processedUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      processedUrl = 'https://' + url;
    }
    
    const hostname = new URL(processedUrl).hostname;
    console.log(`  🔗 Extracted domain: ${hostname} from ${url}`);
    return hostname;
  } catch (error) {
    console.log(`  ❌ Failed to extract domain from: ${url}`, error.message);
    
    // Fallback: Try to extract domain manually
    try {
      // Remove protocol if exists
      const withoutProtocol = url.replace(/^https?:\/\//, '');
      // Get first part (domain)
      const domain = withoutProtocol.split('/')[0].split('?')[0];
      
      if (domain && domain.includes('.')) {
        console.log(`  ✅ Fallback extracted: ${domain}`);
        return domain;
      }
    } catch (fallbackError) {
      console.log(`  ❌ Fallback also failed`);
    }
    
    return null;
  }
}

/**
 * Generate detailed summary for USER'S VIEW
 * Shows everything: apps, files, websites with time ranges
 */
function generateUserDetailedSummary(data) {
  const apps = {};
  let totalDuration = 0;
  
  // Group by app
  data.forEach(activity => {
    const appName = activity.app;
    
    if (!apps[appName]) {
      apps[appName] = {
        name: appName,
        totalDuration: 0,
        category: activity.category,
        items: []
      };
    }
    
    apps[appName].totalDuration += activity.duration;
    totalDuration += activity.duration;
    
    // Determine what to show for this activity
    let itemName = null;
    
    // For VS Code, extract file path from title
    if (appName.toLowerCase().includes('code') || appName.toLowerCase().includes('visual studio')) {
      itemName = extractFilePath(activity.title) || activity.title || 'Untitled';
    } 
    // For browsers, use the title (which includes the page name)
    else if (activity.domain) {
      itemName = activity.title ? activity.title.replace(/ - Google Chrome$| - Mozilla Firefox$| - Safari$/i, '') : activity.domain;
    }
    // For other apps, use title
    else {
      itemName = activity.title || 'Main Window';
    }
    
    // Add this activity to the app's items
    apps[appName].items.push({
      name: itemName,
      duration: activity.duration,
      startTime: activity.timestamp,
      endTime: new Date(activity.timestamp.getTime() + activity.duration * 1000),
      domain: activity.domain
    });
  });
  
  // Convert to array format and merge similar items
  const appsArray = Object.values(apps).map(app => {
    // Group items by name and calculate total duration + time ranges
    const groupedItems = {};
    
    app.items.forEach(item => {
      if (!groupedItems[item.name]) {
        groupedItems[item.name] = {
          name: item.name,
          totalDuration: 0,
          timeRanges: [],
          domain: item.domain
        };
      }
      
      groupedItems[item.name].totalDuration += item.duration;
      groupedItems[item.name].timeRanges.push({
        start: item.startTime,
        end: item.endTime,
        duration: item.duration
      });
    });
    
    // Convert grouped items to array with formatted time ranges
    const itemsArray = Object.values(groupedItems)
      .map(item => {
        // Sort time ranges by start time
        item.timeRanges.sort((a, b) => a.start - b.start);
        
        // Merge consecutive/overlapping time ranges
        const mergedRanges = mergeTimeRanges(item.timeRanges);
        
        return {
          name: item.name,
          hours: (item.totalDuration / 3600).toFixed(2),
          minutes: Math.round(item.totalDuration / 60),
          percentage: ((item.totalDuration / app.totalDuration) * 100).toFixed(1),
          timeRanges: mergedRanges.map(range => ({
            start: formatTime(range.start),
            end: formatTime(range.end),
            duration: Math.round(range.duration / 60)
          })),
          domain: item.domain
        };
      })
      .sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours));
    
    return {
      name: app.name,
      hours: (app.totalDuration / 3600).toFixed(2),
      percentage: ((app.totalDuration / totalDuration) * 100).toFixed(1),
      category: app.category,
      items: itemsArray
    };
  }).sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours));
  
  // Separate apps and websites for charts
  const browserApps = ['chrome', 'firefox', 'safari', 'edge', 'brave', 'opera', 'msedge'];
  const websites = {};
  
  console.log('🔍 Extracting websites from apps:', appsArray.map(a => a.name));
  
  appsArray.forEach(app => {
    const appNameLower = app.name.toLowerCase();
    const isBrowser = browserApps.some(browser => appNameLower.includes(browser));
    
    console.log(`📱 Checking app: ${app.name}, isBrowser: ${isBrowser}`);
    
    if (isBrowser) {
      console.log(`📊 Found browser: ${app.name}, items:`, app.items.length);
      
      app.items.forEach(item => {
        console.log(`  - Item: ${item.name}, domain: ${item.domain}, hours: ${item.hours}`);
        
        const websiteDomain = item.domain || extractDomainFromTitle(item.name);
        
        if (websiteDomain && websiteDomain !== 'null') {
          if (!websites[websiteDomain]) {
            websites[websiteDomain] = 0;
          }
          websites[websiteDomain] += parseFloat(item.hours);
          console.log(`    ✅ Added to websites: ${websiteDomain} = ${item.hours}h`);
        } else {
          const siteName = item.name;
          if (!websites[siteName]) {
            websites[siteName] = 0;
          }
          websites[siteName] += parseFloat(item.hours);
          console.log(`    ✅ Added to websites (no domain): ${siteName} = ${item.hours}h`);
        }
      });
    }
  });
  
  console.log('🌐 Final websites object:', websites);
  console.log('🌐 Websites count:', Object.keys(websites).length);
  
  const websitesArray = Object.entries(websites)
    .map(([name, hours]) => ({
      name,
      hours: hours.toFixed(2),
      percentage: ((hours / (totalDuration / 3600)) * 100).toFixed(1)
    }))
    .sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours));
  
  console.log('📊 Final websitesArray:', websitesArray);
  
  return {
    type: 'detailed',
    apps: appsArray,
    websites: websitesArray,
    totalHours: (totalDuration / 3600).toFixed(2)
  };
}

/**
 * Try to extract domain from a title string
 */
function extractDomainFromTitle(title) {
  if (!title) return null;
  
  const urlPattern = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/;
  const match = title.match(urlPattern);
  
  if (match) {
    return match[1];
  }
  
  return null;
}

/**
 * Merge consecutive or overlapping time ranges
 */
function mergeTimeRanges(ranges) {
  if (ranges.length === 0) return [];
  
  const merged = [];
  let current = { ...ranges[0] };
  
  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];
    
    // If ranges are within 5 minutes of each other, merge them
    if (next.start.getTime() - current.end.getTime() < 5 * 60 * 1000) {
      current.end = new Date(Math.max(current.end.getTime(), next.end.getTime()));
      current.duration += next.duration;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  
  merged.push(current);
  return merged;
}

/**
 * Format time as HH:MM
 */
function formatTime(date) {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Extract file path from VS Code title
 * Example: "app.js - myproject - Visual Studio Code" -> "myproject/app.js"
 */
function extractFilePath(title) {
  if (!title) return null;
  
  let cleaned = title.replace(/\s*-\s*(Visual Studio Code|Code).*$/i, '');
  
  const parts = cleaned.split(' - ').map(p => p.trim());
  
  if (parts.length >= 2) {
    return `${parts[1]}/${parts[0]}`;
  }
  
  return parts[0] || null;
}

async function storeActivityData(userId, processedData) {
  const batch = processedData.map(activity => ({
    userId,
    ...activity,
    createdAt: new Date(),
    aggregated: false
  }));
  
  if (batch.length > 0) {
    await ActivityData.rawCollection().insertMany(batch);
  }
}