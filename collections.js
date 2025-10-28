import { Mongo } from 'meteor/mongo';

export const Tickets = new Mongo.Collection('tickets');
export const Teams = new Mongo.Collection('teams');
export const Sessions = new Mongo.Collection('sessions');

export const ClockEvents = new Mongo.Collection('clockevents');


export const ActivityData = new Mongo.Collection('activityData');
export const ActivitySummary = new Mongo.Collection('activitySummary');
export const CleanupLogs = new Mongo.Collection('cleanupLogs');