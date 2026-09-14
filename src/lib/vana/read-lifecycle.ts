export async function readThenAcknowledge<T>(input: {
  read: () => Promise<T>;
  acknowledge: () => Promise<void>;
  onAcknowledgeError: (error: unknown) => void;
}): Promise<T> {
  const result = await input.read();
  try {
    await input.acknowledge();
  } catch (error) {
    input.onAcknowledgeError(error);
  }
  return result;
}
