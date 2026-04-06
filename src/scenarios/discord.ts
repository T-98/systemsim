import type { TrafficProfile } from '../types';

export const DISCORD_SCENARIO_ID = 'discord_notification_fanout';

export const DISCORD_BRIEF = {
  title: 'Discord Notification Fanout',
  description: `You're on-call at a fast-growing chat platform. The product team just shipped @everyone mentions for servers with 500,000+ members. It goes live in 2 hours. Design the notification fanout system that handles it.`,
  context: `Your platform has 50,000 large servers (500k+ members). @everyone events are expected at 10/second across the platform during peak. Each event must fan out to all members. Users expect to see notifications within 5 seconds.`,
};

export const DISCORD_TRAFFIC_PROFILE: TrafficProfile = {
  profileName: 'discord_everyone_spike',
  durationSeconds: 60,
  phases: [
    { startS: 0, endS: 10, rps: 500, shape: 'steady', description: 'Normal platform load' },
    { startS: 10, endS: 13, rps: 45000, shape: 'instant_spike', description: '@everyone in 3 large servers simultaneously' },
    { startS: 13, endS: 35, rps: 20000, shape: 'steady', description: 'Sustained elevated load as notifications propagate' },
    { startS: 35, endS: 50, rps: 500, shape: 'ramp_down', description: 'Recovery' },
    { startS: 50, endS: 60, rps: 500, shape: 'steady', description: 'Steady state — observe recovery behaviour' },
  ],
  requestMix: {
    'POST /event/everyone': 0.15,
    'POST /notification/fanout': 0.60,
    'GET /notifications/inbox': 0.25,
  },
  userDistribution: 'pareto',
  jitterPercent: 20,
  largeServerConcentration: 0.8,
};

export const DISCORD_DEFAULT_FUNCTIONAL_REQS = [
  'Handle @everyone mentions in servers with 500k+ members',
  'Fan out notifications to all members of a mentioned server',
  'Users can read their notification inbox',
  'Notifications delivered within 5 seconds for the majority of users',
  'Failed deliveries are retried and eventually dead-lettered',
];

export const DISCORD_DEFAULT_NFRS = [
  { attribute: 'latency', target: 'p99 < 5s', scope: 'notification delivery end-to-end' },
  { attribute: 'throughput', target: '5M notifications/s write', scope: 'fanout write path' },
  { attribute: 'availability', target: '99.9%', scope: 'notification read path' },
  { attribute: 'consistency', target: 'eventual', scope: 'notification visibility' },
];

export const DISCORD_SOCRATIC_TEMPLATES = {
  hotShard: (pct: number) =>
    `Shard-2 handled ${pct}% of your write load during the spike. What is it about your partition key that caused that distribution? If you were designing the shard key from scratch, what property would you want it to have?`,
  syncFanout: () =>
    `Your server instance hit 100% CPU at second 32 and started dropping requests. The @everyone event sent 500,000 notifications synchronously. What would the caller's experience have been? What pattern would decouple the event receipt from the notification delivery?`,
  noWriteBatch: () =>
    `Your DB hit connection pool exhaustion within 2 seconds of the spike. You were inserting one row per notification. How many INSERT operations per second does 500k notifications from a single @everyone event require? What does that number suggest about insert strategy?`,
  cacheStampede: () =>
    `At second 95, your DB received a sudden spike even though traffic had dropped. What happened to your cache at that moment? What does it mean for 500,000 users' cache entries to share the same TTL?`,
  queueUndersized: (depth: number) =>
    `Your queue hit max depth at second 45 and started dropping messages. You had configured a max depth of ${depth.toLocaleString()}. The fan-out math for 3 simultaneous @everyone events in 500k-member servers is approximately how many messages? Was the queue sized for that?`,
};

export const DISCORD_HINTS = {
  noQueue: 'Notification fanout can generate millions of writes per event. How would you prevent that write burst from hitting your DB directly?',
  userIdShard: 'What does the distribution of large server memberships look like on your platform? How might that affect which users\' shards receive the most writes?',
};
