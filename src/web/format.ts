export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Unable to complete request. Please retry.';
export const formatDate = (time: number) => new Date(time).toLocaleString();
