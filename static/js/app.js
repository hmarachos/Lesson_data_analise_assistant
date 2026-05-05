const setupComposer = () => {
    const textarea = document.getElementById("message-text");
    const fileInput = document.getElementById("data-file");
    const filePill = document.getElementById("selected-file-pill");
    const thread = document.getElementById("chat-thread");

    if (textarea) {
        const resize = () => {
            textarea.style.height = "auto";
            textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
        };

        resize();
        textarea.addEventListener("input", resize);

        document.querySelectorAll("[data-prompt]").forEach((button) => {
            button.addEventListener("click", () => {
                textarea.value = button.dataset.prompt || "";
                textarea.focus();
                resize();
            });
        });
    }

    if (fileInput && filePill) {
        const syncFilePill = () => {
            const file = fileInput.files?.[0];
            if (!file) {
                filePill.hidden = true;
                filePill.textContent = "";
                return;
            }

            filePill.hidden = false;
            filePill.textContent = `Выбрано: ${file.name}`;
        };

        fileInput.addEventListener("change", syncFilePill);
        syncFilePill();
    }

    if (thread) {
        thread.scrollTop = thread.scrollHeight;
    }
};

const toggleLoader = (show) => {
    const globalLoader = document.getElementById("global-loader");
    if (!globalLoader) {
        return;
    }
    globalLoader.style.display = show ? "inline-flex" : "none";
};

const isChatMessageRequest = (element) => {
    if (!element) {
        return false;
    }

    const requestElement = element.closest?.("[hx-post]") || element;
    const endpoint = requestElement.getAttribute?.("hx-post") || "";
    return /^\/chat\/[^/]+\/message$/.test(endpoint);
};

const toggleAiProcessing = (show) => {
    document.querySelectorAll(".ai-processing").forEach((indicator) => {
        indicator.hidden = !show;
    });

    document.querySelectorAll(".composer button, .quick-grid button").forEach((button) => {
        if (button.disabled && !button.dataset.aiLocked) {
            return;
        }

        if (show) {
            if (button.disabled) {
                button.dataset.aiLocked = "true";
                return;
            }
            button.disabled = true;
            button.dataset.aiDisabled = "true";
            return;
        }

        if (button.dataset.aiDisabled) {
            button.disabled = false;
            delete button.dataset.aiDisabled;
        }
        delete button.dataset.aiLocked;
    });
};

document.addEventListener("DOMContentLoaded", () => {
    setupComposer();

    document.body.addEventListener("htmx:beforeRequest", (event) => {
        toggleLoader(true);
        if (isChatMessageRequest(event.detail?.elt)) {
            toggleAiProcessing(true);
        }
    });

    document.body.addEventListener("htmx:afterRequest", () => {
        toggleLoader(false);
        toggleAiProcessing(false);
    });

    document.body.addEventListener("htmx:afterSwap", () => {
        toggleLoader(false);
        toggleAiProcessing(false);
        setupComposer();
    });
});
