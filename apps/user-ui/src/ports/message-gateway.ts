export type MessageGateway = {
  revealSensitive: (options: { eventId: string; password: string }) => Promise<{ text?: string }>;
};
