/** Start a browser download and release its temporary object URL afterward. */
export function downloadBlob(blob: Blob, fileName: string): void {
    const url = window.URL.createObjectURL(blob);
    try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
    } finally {
        // Let the browser consume the URL before releasing it.
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    }
}

/** Retry only failures that may succeed without changing the request. */
export function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500 && status <= 599;
}
