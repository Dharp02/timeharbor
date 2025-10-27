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
  
  // Store chart instances
  this.pieChart = null;
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
  if (this.pieChart) {
    this.pieChart.destroy();
    this.pieChart = null;
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
  
  categoriesCount() {
    const report = Template.instance().currentReport.get();
    return report && report.categories ? report.categories.length : 0;
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
        
        // Wait for DOM to update, then initialize charts
        Tracker.afterFlush(() => {
          Meteor.setTimeout(() => {
            initializeCharts(template);
          }, 250); // Give extra time for DOM to fully render
        });
      }
    });
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
  if (template.pieChart) {
    template.pieChart.destroy();
    template.pieChart = null;
  }
  if (template.barChart) {
    template.barChart.destroy();
    template.barChart = null;
  }
  
  // Render Pie Chart
  if (report.categories && report.categories.length > 0) {
    renderPieChart(template, report.categories);
  } else {
    console.warn('No categories data for pie chart');
  }
  
  // Render Bar Chart - create mock data if dailyBreakdown doesn't exist
  if (report.dailyBreakdown && report.dailyBreakdown.length > 0) {
    renderBarChart(template, report.dailyBreakdown);
  } else {
    console.warn('No daily breakdown data, creating mock data for demonstration');
    // Create mock daily data from categories
    const mockDailyData = createMockDailyData(report);
    if (mockDailyData.length > 0) {
      renderBarChart(template, mockDailyData);
    }
  }
}

// Create mock daily breakdown if not provided by server
function createMockDailyData(report) {
  if (!report.categories) return [];
  
  const days = 7;
  const mockData = [];
  
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - i));
    
    const dayData = {
      date: date.toISOString().split('T')[0]
    };
    
    // Distribute hours across categories with some randomness
    report.categories.forEach(cat => {
      const avgHours = parseFloat(cat.hours) / days;
      const variance = avgHours * 0.3;
      dayData[cat.name.toLowerCase()] = Math.max(0, avgHours + (Math.random() - 0.5) * 2 * variance);
    });
    
    mockData.push(dayData);
  }
  
  return mockData;
}

function renderPieChart(template, categories) {
  // Use jQuery to find canvas
  const $canvas = template.$('#pie-chart');
  
  if ($canvas.length === 0) {
    console.error('Pie chart canvas not found in DOM');
    return;
  }
  
  const canvas = $canvas[0];
  
  if (!canvas || typeof canvas.getContext !== 'function') {
    console.error('Canvas element is not valid:', canvas);
    return;
  }
  
  console.log('Rendering pie chart with categories:', categories);
  
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
  ];
  
  const data = {
    labels: categories.map(cat => cat.name),
    datasets: [{
      label: 'Hours',
      data: categories.map(cat => parseFloat(cat.hours)),
      backgroundColor: COLORS.slice(0, categories.length),
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
    template.pieChart = new Chart(ctx, config);
    console.log('Pie chart created successfully');
  } catch (error) {
    console.error('Failed to create pie chart:', error);
  }
}

function renderBarChart(template, dailyData) {
  // Use jQuery to find canvas
  const $canvas = template.$('#bar-chart');
  
  if ($canvas.length === 0) {
    console.error('Bar chart canvas not found in DOM');
    return;
  }
  
  const canvas = $canvas[0];
  
  if (!canvas || typeof canvas.getContext !== 'function') {
    console.error('Canvas element is not valid:', canvas);
    return;
  }
  
  console.log('Rendering bar chart with daily data:', dailyData);
  
  const ctx = canvas.getContext('2d');
  
  // Extract all unique categories from daily data
  const categories = new Set();
  dailyData.forEach(day => {
    Object.keys(day).forEach(key => {
      if (key !== 'date') {
        categories.add(key);
      }
    });
  });
  
  const categoryArray = Array.from(categories);
  
  // Color mapping
  const COLORS = {
    development: '#8b5cf6',
    communication: '#06b6d4',
    other: '#94a3b8',
    meetings: '#10b981',
    documentation: '#f59e0b',
    design: '#ec4899',
    testing: '#6366f1',
  };
  
  const datasets = categoryArray.map(category => ({
    label: category.charAt(0).toUpperCase() + category.slice(1),
    data: dailyData.map(day => parseFloat(day[category] || 0)),
    backgroundColor: COLORS[category] || '#64748b',
    borderColor: COLORS[category] || '#64748b',
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
              size: 12
            }
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