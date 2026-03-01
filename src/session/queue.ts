/**
 * Per-session FIFO message queue.
 * Ensures messages are processed sequentially per session.
 */

interface QueueItem {
  text: string;
  chatId: string;
  messageId: string;
}

export class MessageQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private processor?: (item: QueueItem) => Promise<void>;

  /** Set the message processor function. */
  onProcess(handler: (item: QueueItem) => Promise<void>): void {
    this.processor = handler;
  }

  /** Enqueue a message for processing. */
  enqueue(text: string, chatId: string, messageId: string): void {
    this.queue.push({ text, chatId, messageId });
    this.drain();
  }

  /** Check if the queue is currently processing. */
  get busy(): boolean {
    return this.processing;
  }

  /** Number of messages waiting. */
  get length(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    if (this.processing || !this.processor) return;

    while (this.queue.length > 0) {
      this.processing = true;
      const item = this.queue.shift()!;
      try {
        await this.processor(item);
      } catch (err) {
        console.error("[queue] Processing error:", err);
      }
    }
    this.processing = false;
  }
}
