// imports/ui/components/activityReport.js

import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import './activityReport.html';

Template.activityReport.onCreated(function() {
  this.awConnected = new ReactiveVar(false);
  this.checkingConnection = new ReactiveVar(true);
  this.generatingReport = new ReactiveVar(false);
  this.currentReport = new ReactiveVar(null);
  
  // Check ActivityWatch connection on load
  Meteor.call('activityWatch.checkConnection', (error, result) => {
    this.checkingConnection.set(false);
    if (result) {
      this.awConnected.set(result.connected);
    }
  });
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
  }
});

Template.activityReport.events({
  'click .generate-report'(event, template) {
    template.generatingReport.set(true);
    
    // Get last 7 days
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];
    
    Meteor.call('activityWatch.generateReport', startDate, endDate, (error, result) => {
      template.generatingReport.set(false);
      
      if (error) {
        alert('Failed to generate report: ' + error.message);
      } else {
        template.currentReport.set(result.summary);
        // Store summaryId for sharing
        template.currentSummaryId = result.summaryId;
      }
    });
  },
  
  'click .share-report'(event, template) {
    const summaryId = template.currentSummaryId;
    
    if (!summaryId) {
      alert('No report to share');
      return;
    }
    
    if (confirm('Share this report with your manager?')) {
      Meteor.call('activityWatch.shareSummary', summaryId, (error) => {
        if (error) {
          alert('Failed to share: ' + error.message);
        } else {
          alert('Report shared successfully!');
        }
      });
    }
  }
});