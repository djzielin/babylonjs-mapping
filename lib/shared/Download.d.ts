/** Start a browser download and release its temporary object URL afterward. */
export declare function downloadBlob(blob: Blob, fileName: string): void;
/** Retry only failures that may succeed without changing the request. */
export declare function isRetryableStatus(status: number): boolean;
