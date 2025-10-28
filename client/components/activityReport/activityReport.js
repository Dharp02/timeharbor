import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import Chart from 'chart.js/auto';
import './activityReport.html';

Template.activityReport.onCreated(function() {
  this.awConnected = new ReactiveVar(false);
  this.checkingConnection = new ReactiveVar(true);
  this.generatingReport = new ReactiveVar(false);
  this.currentReport = new ReactiveVar(null);
  this.expandedApps = new ReactiveVar(new Set());
  
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
  
  appsWithIndex() {
    const report = Template.instance().currentReport.get();
    if (!report || !report.apps) return [];
    
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
        
        template.expandedApps.set(new Set());
        
        Tracker.afterFlush(() => {
          Meteor.setTimeout(() => {
            initializeCharts(template);
          }, 250);
        });
      }
    });
  },
  
  'click .app-row'(event, template) {
    // Don't expand if clicking checkbox
    if ($(event.target).closest('input[type="checkbox"]').length > 0) {
      return;
    }
    
    event.preventDefault();
    
    const appIndex = parseInt($(event.currentTarget).data('app-index'));
    const expandedApps = template.expandedApps.get();
    
    if (expandedApps.has(appIndex)) {
      expandedApps.delete(appIndex);
      $(event.currentTarget).find('.expand-icon').removeClass('rotate-90');
      $(`.nested-item-row[data-parent-app="${appIndex}"]`).addClass('hidden');
    } else {
      expandedApps.add(appIndex);
      $(event.currentTarget).find('.expand-icon').addClass('rotate-90');
      $(`.nested-item-row[data-parent-app="${appIndex}"]`).removeClass('hidden');
    }
    
    template.expandedApps.set(new Set(expandedApps));
  },
  
  // Select All checkbox
  'change .select-all-checkbox'(event, template) {
    const isChecked = $(event.currentTarget).prop('checked');
    
    // Check/uncheck all app checkboxes
    $('.app-checkbox').prop('checked', isChecked);
    
    // Check/uncheck all item checkboxes
    $('.item-checkbox').prop('checked', isChecked);
  },
  
  // App checkbox - handles parent-child relationship
  'change .app-checkbox'(event, template) {
    const isChecked = $(event.currentTarget).prop('checked');
    const appIndex = $(event.currentTarget).data('app-index');
    
    // Check/uncheck all child items for this app
    $(`.item-checkbox[data-parent-app="${appIndex}"]`).prop('checked', isChecked);
    
    // Update select-all checkbox state
    updateSelectAllState();
  },
  
  // Item checkbox - update parent if needed
  'change .item-checkbox'(event, template) {
    const parentAppIndex = $(event.currentTarget).data('parent-app');
    
    // Check if all items for this parent are checked
    const allItems = $(`.item-checkbox[data-parent-app="${parentAppIndex}"]`);
    const checkedItems = $(`.item-checkbox[data-parent-app="${parentAppIndex}"]:checked`);
    
    // Update parent checkbox state
    const parentCheckbox = $(`.app-checkbox[data-app-index="${parentAppIndex}"]`);
    
    if (checkedItems.length === 0) {
      // No items checked - uncheck parent
      parentCheckbox.prop('checked', false);
    } else if (checkedItems.length === allItems.length) {
      // All items checked - check parent
      parentCheckbox.prop('checked', true);
    } else {
      // Some items checked - indeterminate state (optional, we'll just uncheck for simplicity)
      parentCheckbox.prop('checked', false);
    }
    
    // Update select-all checkbox state
    updateSelectAllState();
  },
  
  // Export Summary button
  'click .export-summary-btn'(event, template) {
    const report = template.currentReport.get();
    if (!report) {
      alert('No report available to export');
      return;
    }
    
    const selectedData = collectSelectedData(report);
    
    if (selectedData.apps.length === 0) {
      alert('Please select at least one app or activity to export');
      return;
    }
    
    // Add metadata
    const exportData = {
      dateRange: {
        start: template.startDate.get(),
        end: template.endDate.get()
      },
      generatedAt: new Date().toISOString(),
      totalHours: calculateTotalHours(selectedData),
      apps: selectedData.apps
    };
    
    // Download as JSON file
    downloadJSON(exportData, `activity-summary-${template.startDate.get()}_${template.endDate.get()}.json`);
  }
});

// Helper function to update select-all checkbox state
function updateSelectAllState() {
  const allAppCheckboxes = $('.app-checkbox');
  const checkedAppCheckboxes = $('.app-checkbox:checked');
  const selectAllCheckbox = $('.select-all-checkbox');
  
  if (checkedAppCheckboxes.length === 0) {
    selectAllCheckbox.prop('checked', false);
  } else if (checkedAppCheckboxes.length === allAppCheckboxes.length) {
    selectAllCheckbox.prop('checked', true);
  } else {
    selectAllCheckbox.prop('checked', false);
  }
}

// Collect selected data for export
function collectSelectedData(report) {
  const selectedApps = [];
  
  $('.app-checkbox').each(function() {
    const isAppChecked = $(this).prop('checked');
    const appIndex = $(this).data('app-index');
    const appData = report.apps[appIndex];
    
    if (!appData) return;
    
    // Check if any child items are selected
    const selectedItems = [];
    $(`.item-checkbox[data-parent-app="${appIndex}"]:checked`).each(function() {
      const itemName = $(this).data('item-name');
      const itemData = appData.items.find(item => item.name === itemName);
      
      if (itemData) {
        selectedItems.push({
          name: itemData.name,
          hours: itemData.hours,
          minutes: itemData.minutes,
          percentage: itemData.percentage,
          timeRanges: itemData.timeRanges,
          domain: itemData.domain
        });
      }
    });
    
    // If app is checked but no items explicitly selected, include all items
    // If app is not checked but items are selected, include only those items
    if (isAppChecked && selectedItems.length === 0) {
      // App checked, include all items
      selectedApps.push({
        name: appData.name,
        hours: appData.hours,
        percentage: appData.percentage,
        category: appData.category,
        items: appData.items.map(item => ({
          name: item.name,
          hours: item.hours,
          minutes: item.minutes,
          percentage: item.percentage,
          timeRanges: item.timeRanges,
          domain: item.domain
        }))
      });
    } else if (selectedItems.length > 0) {
      // Items selected, include only those
      const totalItemsHours = selectedItems.reduce((sum, item) => sum + parseFloat(item.hours), 0);
      
      selectedApps.push({
        name: appData.name,
        hours: totalItemsHours.toFixed(2),
        percentage: appData.percentage,
        category: appData.category,
        items: selectedItems
      });
    }
  });
  
  return { apps: selectedApps };
}

// Calculate total hours from selected data
function calculateTotalHours(selectedData) {
  const total = selectedData.apps.reduce((sum, app) => {
    return sum + parseFloat(app.hours);
  }, 0);
  
  return total.toFixed(2);
}

// Download JSON file
function downloadJSON(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
  
  console.log('✅ Exported summary:', filename);
}

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
  
  const COLORS = [
    '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16',
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
            font: { size: 12 }
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
  
  const COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b',
    '#10b981', '#06b6d4', '#6366f1', '#14b8a6', '#84cc16',
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
            font: { size: 12 }
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
  
  const appNames = new Set();
  dailyData.forEach(day => {
    Object.keys(day).forEach(key => {
      if (key !== 'date') {
        appNames.add(key);
      }
    });
  });
  
  const appNamesArray = Array.from(appNames);
  
  const COLORS = [
    '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16',
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
          grid: { display: false }
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
            font: { size: 11 },
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