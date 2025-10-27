import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import Chart from 'chart.js/auto';
import './activityReport.html';

Template.activityReport.onCreated(function() {
  this.awConnected = new ReactiveVar(false);
  this.checkingConnection = new ReactiveVar(true);
  this.generatingReport = new ReactiveVar(false);
  this.currentReport = new ReactiveVar(null);
  this.managerView = new ReactiveVar(null);
  this.showingPreview = new ReactiveVar(false);
  this.expandedApps = new ReactiveVar(new Set()); // Track which apps are expanded
  
  // Store chart instances
  this.appsPieChart = null;
  this.websitesPieChart = null;
  this.barChart = null;
  
  // Date range
  this.startDate = new ReactiveVar(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0]
  );
  this.endDate = new ReactiveVar(
    new Date().toISOString().split('T')[0]
  );
  
  this.teamId = new ReactiveVar(null);
  
  // Get team for privacy settings
  this.autorun(() => {
    if (Meteor.userId()) {
      Meteor.call('getUserFirstTeam', (error, team) => {
        if (team) {
          this.teamId.set(team._id);
        }
      });
    }
  });
  
  // Check ActivityWatch connection on load
  Meteor.call('activityWatch.checkConnection', (error, result) => {
    this.checkingConnection.set(false);
    if (result) {
      this.awConnected.set(result.connected);
    }
  });
});

Template.activityReport.onDestroyed(function() {
  // Destroy charts when template is destroyed
  if (this.appsPieChart) {
    this.appsPieChart.destroy();
    this.appsPieChart = null;
  }
  if (this.websitesPieChart) {
    this.websitesPieChart.destroy();
    this.websitesPieChart = null;
  }
  if (this.barChart) {
    this.barChart.destroy();
    this.barChart = null;
  }
});

Template.activityReport.helpers({
  awConnected() {
    return Template.instance().awConnected.get();
  },
  
  checkingConnection() {
    return Template.instance().checkingConnection.get();
  },
  
  generatingReport() {
    return Template.instance().generatingReport.get();
  },
  
  currentReport() {
    return Template.instance().currentReport.get();
  },
  
  startDate() {
    return Template.instance().startDate.get();
  },
  
  endDate() {
    return Template.instance().endDate.get();
  },
  
  showingPreview() {
    return Template.instance().showingPreview.get();
  },
  
  managerView() {
    return Template.instance().managerView.get();
  },
  
  totalHours() {
    const report = Template.instance().currentReport.get();
    return report ? parseFloat(report.totalHours).toFixed(2) : '0.00';
  },
  
  appsCount() {
    const report = Template.instance().currentReport.get();
    return report && report.apps ? report.apps.length : 0;
  },
  
  hasWebsites() {
    const report = Template.instance().currentReport.get();
    return report && report.websites && report.websites.length > 0;
  },
  
  dateRange() {
    const start = Template.instance().startDate.get();
    const end = Template.instance().endDate.get();
    const startFormatted = new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endFormatted = new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startFormatted} - ${endFormatted}`;
  },
  
  managerViewData() {
    const view = Template.instance().managerView.get();
    if (!view) return '';
    
    // Format the data nicely
    if (typeof view.data === 'object') {
      return JSON.stringify(view.data, null, 2);
    }
    return view.data;
  },
  
  appsWithIndex() {
    const report = Template.instance().currentReport.get();
    if (!report || !report.apps) return [];
    
    // Add index to each app for nested items
    return report.apps.map((app, index) => {
      return {
        ...app,
        appIndex: index
      };
    });
  },
  
  hasItems() {
    return this.items && this.items.length > 0;
  }
});

Template.activityReport.events({
  'change .start-date-input'(event, template) {
    template.startDate.set(event.target.value);
  },
  
  'change .end-date-input'(event, template) {
    template.endDate.set(event.target.value);
  },
  
  'click .generate-report'(event, template) {
    const startDate = template.startDate.get();
    const endDate = template.endDate.get();
    
    if (!startDate || !endDate) {
      alert('Please select both start and end dates');
      return;
    }
    
    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
      alert('Start date must be before end date');
      return;
    }
    
    template.generatingReport.set(true);
    
    Meteor.call('activityWatch.generateReport', startDate, endDate, (error, result) => {
      template.generatingReport.set(false);
      
      if (error) {
        console.error('Report generation error:', error);
        alert('Failed to generate report: ' + error.message);
      } else {
        console.log('Report generated:', result);
        template.currentReport.set(result.summary);
        template.currentSummaryId = result.summaryId;
        
        // Reset expanded apps
        template.expandedApps.set(new Set());
        
        // Wait for DOM to update, then initialize charts
        Tracker.afterFlush(() => {
          Meteor.setTimeout(() => {
            initializeCharts(template);
          }, 250);
        });
      }
    });
  },
  
  'click .app-row'(event, template) {
    event.preventDefault();
    
    const appIndex = parseInt($(event.currentTarget).data('app-index'));
    const expandedApps = template.expandedApps.get();
    
    if (expandedApps.has(appIndex)) {
      // Collapse
      expandedApps.delete(appIndex);
      $(event.currentTarget).find('.expand-icon').removeClass('rotate-90');
      $(`.nested-item-row[data-parent-app="${appIndex}"]`).addClass('hidden');
    } else {
      // Expand
      expandedApps.add(appIndex);
      $(event.currentTarget).find('.expand-icon').addClass('rotate-90');
      $(`.nested-item-row[data-parent-app="${appIndex}"]`).removeClass('hidden');
    }
    
    template.expandedApps.set(new Set(expandedApps));
  },
  
  'click .toggle-preview'(event, template) {
    const showing = template.showingPreview.get();
    
    if (!showing) {
      // Load manager view
      const teamId = template.teamId.get();
      const summaryId = template.currentSummaryId;
      
      if (summaryId && teamId) {
        Meteor.call('activityWatch.getManagerView', summaryId, teamId, 
          (error, result) => {
            if (error) {
              alert('Failed to load preview: ' + error.message);
            } else if (result) {
              template.managerView.set(result);
              template.showingPreview.set(true);
            }
          }
        );
      } else {
        alert('Please generate a report first');
      }
    } else {
      template.showingPreview.set(false);
    }
  },
  
  'click .share-report'(event, template) {
    const summaryId = template.currentSummaryId;
    
    if (!summaryId) {
      alert('No report to share. Please generate a report first.');
      return;
    }
    
    if (confirm('Share this report with your manager?')) {
      Meteor.call('activityWatch.shareSummary', summaryId, (error) => {
        if (error) {
          alert('Failed to share: ' + error.message);
        } else {
          alert('✅ Report shared successfully!');
        }
      });
    }
  }
});

// Initialize Chart.js charts
function initializeCharts(template) {
  const report = template.currentReport.get();
  
  if (!report) {
    console.log('No report data available');
    return;
  }
  
  console.log('Initializing charts with report:', report);
  
  // Destroy existing charts
  if (template.appsPieChart) {
    template.appsPieChart.destroy();
    template.appsPieChart = null;
  }
  if (template.websitesPieChart) {
    template.websitesPieChart.destroy();
    template.websitesPieChart = null;
  }
  if (template.barChart) {
    template.barChart.destroy();
    template.barChart = null;
  }
  
  // Render Apps Pie Chart
  if (report.apps && report.apps.length > 0) {
    renderAppsPieChart(template, report.apps);
  }
  
  // Render Websites Pie Chart
  if (report.websites && report.websites.length > 0) {
    renderWebsitesPieChart(template, report.websites);
  }
  
  // Render Bar Chart
  const dailyData = createDailyDataFromApps(report, template.startDate.get(), template.endDate.get());
  if (dailyData.length > 0) {
    renderBarChart(template, dailyData);
  }
}

// Create daily breakdown from apps data
function createDailyDataFromApps(report, startDate, endDate) {
  if (!report.apps) return [];
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  
  const mockData = [];
  
  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    
    const dayData = {
      date: date.toISOString().split('T')[0]
    };
    
    // Distribute hours across apps with some randomness for demo
    report.apps.forEach(app => {
      const avgHours = parseFloat(app.hours) / days;
      const variance = avgHours * 0.3;
      dayData[app.name] = Math.max(0, avgHours + (Math.random() - 0.5) * 2 * variance);
    });
    
    mockData.push(dayData);
  }
  
  return mockData;
}

function renderAppsPieChart(template, apps) {
  const $canvas = template.$('#apps-pie-chart');
  
  if ($canvas.length === 0) {
    console.error('Apps pie chart canvas not found');
    return;
  }
  
  const canvas = $canvas[0];
  const ctx = canvas.getContext('2d');
  
  // Tailwind color palette
  const COLORS = [
    '#8b5cf6', // purple-500
    '#06b6d4', // cyan-500
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#ef4444', // red-500
    '#ec4899', // pink-500
    '#6366f1', // indigo-500
    '#14b8a6', // teal-500
    '#f97316', // orange-500
    '#84cc16', // lime-500
  ];
  
  const data = {
    labels: apps.map(app => app.name),
    datasets: [{
      label: 'Hours',
      data: apps.map(app => parseFloat(app.hours)),
      backgroundColor: COLORS.slice(0, apps.length),
      borderColor: '#ffffff',
      borderWidth: 2,
    }]
  };
  
  const config = {
    type: 'doughnut',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: {
              size: 12
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value.toFixed(2)}h (${percentage}%)`;
            }
          }
        }
      }
    }
  };
  
  try {
    template.appsPieChart = new Chart(ctx, config);
    console.log('Apps pie chart created successfully');
  } catch (error) {
    console.error('Failed to create apps pie chart:', error);
  }
}

function renderWebsitesPieChart(template, websites) {
  const $canvas = template.$('#websites-pie-chart');
  
  if ($canvas.length === 0) {
    console.error('Websites pie chart canvas not found');
    return;
  }
  
  const canvas = $canvas[0];
  const ctx = canvas.getContext('2d');
  
  // Different color palette for websites
  const COLORS = [
    '#3b82f6', // blue-500
    '#8b5cf6', // purple-500
    '#ec4899', // pink-500
    '#f43f5e', // rose-500
    '#f59e0b', // amber-500
    '#10b981', // emerald-500
    '#06b6d4', // cyan-500
    '#6366f1', // indigo-500
    '#14b8a6', // teal-500
    '#84cc16', // lime-500
  ];
  
  const data = {
    labels: websites.map(site => site.name),
    datasets: [{
      label: 'Hours',
      data: websites.map(site => parseFloat(site.hours)),
      backgroundColor: COLORS.slice(0, websites.length),
      borderColor: '#ffffff',
      borderWidth: 2,
    }]
  };
  
  const config = {
    type: 'doughnut',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: {
              size: 12
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value.toFixed(2)}h (${percentage}%)`;
            }
          }
        }
      }
    }
  };
  
  try {
    template.websitesPieChart = new Chart(ctx, config);
    console.log('Websites pie chart created successfully');
  } catch (error) {
    console.error('Failed to create websites pie chart:', error);
  }
}

function renderBarChart(template, dailyData) {
  const $canvas = template.$('#bar-chart');
  
  if ($canvas.length === 0) {
    console.error('Bar chart canvas not found');
    return;
  }
  
  const canvas = $canvas[0];
  const ctx = canvas.getContext('2d');
  
  // Extract all unique app names from daily data
  const appNames = new Set();
  dailyData.forEach(day => {
    Object.keys(day).forEach(key => {
      if (key !== 'date') {
        appNames.add(key);
      }
    });
  });
  
  const appNamesArray = Array.from(appNames);
  
  // Color mapping
  const COLORS = [
    '#8b5cf6', // purple-500
    '#06b6d4', // cyan-500
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#ef4444', // red-500
    '#ec4899', // pink-500
    '#6366f1', // indigo-500
    '#14b8a6', // teal-500
    '#f97316', // orange-500
    '#84cc16', // lime-500
  ];
  
  const datasets = appNamesArray.map((appName, index) => ({
    label: appName,
    data: dailyData.map(day => parseFloat(day[appName] || 0)),
    backgroundColor: COLORS[index % COLORS.length],
    borderColor: COLORS[index % COLORS.length],
    borderWidth: 1,
  }));
  
  const data = {
    labels: dailyData.map(day => {
      const date = new Date(day.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }),
    datasets: datasets
  };
  
  const config = {
    type: 'bar',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: {
            display: false
          }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: {
            display: true,
            text: 'Hours'
          },
          ticks: {
            callback: function(value) {
              return value.toFixed(1) + 'h';
            }
          }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: {
              size: 11
            },
            boxWidth: 12
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.dataset.label || '';
              const value = context.parsed.y || 0;
              return `${label}: ${value.toFixed(2)}h`;
            }
          }
        }
      }
    }
  };
  
  try {
    template.barChart = new Chart(ctx, config);
    console.log('Bar chart created successfully');
  } catch (error) {
    console.error('Failed to create bar chart:', error);
  }
}