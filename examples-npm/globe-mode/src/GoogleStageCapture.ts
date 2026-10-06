/** Optional visual inspection hold; timing benchmarks must omit captureStage. */
export function holdGoogleStageForCapture(stage: "coverage" | "immediate", signal: AbortSignal): Promise<void> {
    if (new URLSearchParams(location.search).get("captureStage") !== stage) return Promise.resolve();
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const button = document.createElement("button");
        button.textContent = stage === "coverage" ? "Baseline ready · continue" : "Nearby detail ready · continue";
        button.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000;padding:12px 20px;background:#132838;color:white;border:1px solid #93b6cc;border-radius:6px";
        button.dataset.googleStageCapture = stage;
        const clean = () => { button.remove(); signal.removeEventListener("abort", cancel); };
        const cancel = () => { clean(); reject(signal.reason); };
        button.addEventListener("click", () => { clean(); resolve(); }, { once: true });
        signal.addEventListener("abort", cancel, { once: true });
        document.body.append(button);
    });
}
