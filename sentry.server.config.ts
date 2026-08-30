import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1,
  enableLogs: true,
  includeLocalVariables: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: {
      inputs: true,
      outputs: true,
    },
    stackFrameVariables: false,
  },
});
