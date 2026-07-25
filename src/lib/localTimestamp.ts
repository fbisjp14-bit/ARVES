export class LocalTimestamp {
  seconds: number;
  nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static now(): LocalTimestamp {
    const milliseconds = Date.now();
    return new LocalTimestamp(
      Math.floor(milliseconds / 1_000),
      (milliseconds % 1_000) * 1_000_000
    );
  }

  toDate(): Date {
    return new Date(this.seconds * 1_000 + this.nanoseconds / 1_000_000);
  }

  toISOString(): string {
    return this.toDate().toISOString();
  }
}
