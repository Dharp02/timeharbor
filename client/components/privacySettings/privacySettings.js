import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import './privacySettings.html';

Template.privacySettings.onCreated(function() {
  this.settings = new ReactiveVar(null);
  this.loading = new ReactiveVar(true);
  this.saveSuccess = new ReactiveVar(false);
  this.teamId = new ReactiveVar(null); // Set this based on current team

  this.autorun(() => {
    if (Meteor.userId()) {
      Meteor.call('getUserFirstTeam', (error, team) => {
        if (team) {
          this.teamId.set(team._id);
        }
      });
    }
  });
  
  // Load settings when team is set
  this.autorun(() => {
    const teamId = this.teamId.get();
    if (teamId) {
      Meteor.call('activityWatch.getPrivacySettings', teamId, (error, result) => {
        this.loading.set(false);
        if (result) {
          this.settings.set(result);
        }
      });
    }
  });
});

Template.privacySettings.helpers({
  isTeamAdmin() {
    // Check if current user is admin
    //const teamId = Template.instance().teamId.get();
    // Implement your admin check logic
    return true; // For now
  },
  
  loading() {
    return Template.instance().loading.get();
  },
  
  settings() {
    return Template.instance().settings.get();
  },
  
  isSelected(level) {
    const settings = Template.instance().settings.get();
    return settings?.privacyLevel === level ? 'selected' : '';
  },
  
  privacyLevelDescription() {
    const settings = Template.instance().settings.get();
    const level = settings?.privacyLevel || 1;
    
    const descriptions = {
      1: 'Managers see only category totals (Development: 6h, Communication: 2h)',
      2: 'Managers see app names but not websites (VS Code: 4h, Chrome: 3h)',
      3: 'Managers see work-related websites based on domain filtering'
    };
    
    return descriptions[level];
  },
  
  showDomainSettings() {
    const settings = Template.instance().settings.get();
    return settings?.privacyLevel === 3;
  },
  
  workDomainsText() {
    const settings = Template.instance().settings.get();
    return settings?.workRelatedDomains?.join('\n') || '';
  },
  
  blockedDomainsText() {
    const settings = Template.instance().settings.get();
    return settings?.blockedDomains?.join('\n') || '';
  },
  
  saveSuccess() {
    return Template.instance().saveSuccess.get();
  }
});

Template.privacySettings.events({
  'change .privacy-level-select'(event, template) {
    const newLevel = parseInt(event.target.value);
    const settings = template.settings.get();
    settings.privacyLevel = newLevel;
    template.settings.set(settings);
  },
  
  'click .save-settings'(event, template) {
    event.preventDefault();
    
    const teamId = template.teamId.get();
    const privacyLevel = parseInt(template.find('.privacy-level-select').value);
    const cleanupDays = parseInt(template.find('.cleanup-days-input').value);
    const keepMonths = parseInt(template.find('.keep-summaries-input').value);
    
    let workDomains = [];
    let blockedDomains = [];
    
    if (privacyLevel === 3) {
      const workDomainsText = template.find('.work-domains-input').value;
      const blockedDomainsText = template.find('.blocked-domains-input').value;
      
      workDomains = workDomainsText
        .split('\n')
        .map(d => d.trim())
        .filter(d => d.length > 0);
      
      blockedDomains = blockedDomainsText
        .split('\n')
        .map(d => d.trim())
        .filter(d => d.length > 0);
    }
    
    const settings = {
      privacyLevel,
      workRelatedDomains: workDomains,
      blockedDomains: blockedDomains,
      autoCleanupDays: cleanupDays,
      keepSummariesMonths: keepMonths
    };
    
    Meteor.call('activityWatch.updatePrivacySettings', teamId, settings, (error) => {
      if (error) {
        alert('Failed to save: ' + error.message);
      } else {
        template.saveSuccess.set(true);
        setTimeout(() => template.saveSuccess.set(false), 3000);
      }
    });
  }
});