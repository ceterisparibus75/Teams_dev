export const MICROSOFT_GRAPH_SCOPES = [
  'User.Read',
  'Calendars.Read',
  'OnlineMeetings.Read',
  'OnlineMeetingTranscript.Read.All',
  'Mail.Send',
] as const

export const MICROSOFT_AUTHORIZATION_SCOPE = [
  'openid',
  'profile',
  'email',
  'offline_access',
  ...MICROSOFT_GRAPH_SCOPES,
].join(' ')
