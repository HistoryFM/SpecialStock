import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1,
  enableLogs: true,
  replaysSessionSampleRate: 1,
  replaysOnErrorSampleRate: 1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
    urlQueryParams: false,
  },
  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      maskAllInputs: false,
      blockAllMedia: false,
      mask: ["input[type='password']", ".sentry-mask", "[data-sentry-mask]"],
      block: [".sentry-block", "[data-sentry-block]"],
      ignore: [".sentry-ignore", "[data-sentry-ignore]"],
    }),
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
