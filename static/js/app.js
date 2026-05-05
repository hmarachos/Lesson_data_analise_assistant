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

    setupStreamingForms();
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

const escapeHtml = (value) => {
    const div = document.createElement("div");
    div.textContent = value || "";
    return div.innerHTML;
};

const scrollChatToBottom = () => {
    const thread = document.getElementById("chat-thread");
    if (thread) {
        thread.scrollTop = thread.scrollHeight;
    }
};

const appendUserMessage = ({ text, time_label: timeLabel, file_name: fileName }) => {
    const thread = document.getElementById("chat-thread");
    if (!thread) {
        return;
    }

    const attachment = fileName
        ? `<div class="artifact-stack"><div class="artifact-card"><div><strong>Вложение</strong><div class="artifact-card__name">${escapeHtml(fileName)}</div></div></div></div>`
        : "";

    thread.insertAdjacentHTML(
        "beforeend",
        `<article class="message message--user message--streaming">
            <div class="message__avatar">You</div>
            <div class="message__body">
                <div class="message__meta">
                    <strong>Вы</strong>
                    <span>${escapeHtml(timeLabel || "")}</span>
                </div>
                <div class="message-text">${escapeHtml(text)}</div>
                ${attachment}
            </div>
        </article>`,
    );
    scrollChatToBottom();
};

const createAssistantStreamMessage = ({ time_label: timeLabel }) => {
    const thread = document.getElementById("chat-thread");
    if (!thread) {
        return null;
    }

    thread.insertAdjacentHTML(
        "beforeend",
        `<article class="message message--assistant message--streaming">
            <div class="message__avatar">AI</div>
            <div class="message__body">
                <div class="message__meta">
                    <strong>Data Assistant</strong>
                    <span>${escapeHtml(timeLabel || "")}</span>
                </div>
                <div class="message-text" data-stream-text></div>
                <div class="stream-cursor" aria-hidden="true"></div>
            </div>
        </article>`,
    );
    scrollChatToBottom();
    return thread.querySelector(".message--assistant.message--streaming:last-child [data-stream-text]");
};

const updateAiProcessingStatus = ({ title, text, step }) => {
    document.querySelectorAll(".ai-processing").forEach((indicator) => {
        indicator.hidden = false;
        indicator.dataset.step = String(step || 1);
        const titleEl = indicator.querySelector("strong");
        const textEl = indicator.querySelector("span");
        if (titleEl) {
            titleEl.textContent = title || "Нейросеть обрабатывает запрос";
        }
        if (textEl) {
            textEl.textContent = text || "Формируем ответ...";
        }
    });
};

const parseEventBlock = (block) => {
    const lines = block.split("\n");
    let event = "message";
    const dataLines = [];

    lines.forEach((line) => {
        if (line.startsWith("event:")) {
            event = line.slice(6).trim();
        }
        if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
        }
    });

    const rawData = dataLines.join("\n");
    return {
        event,
        data: rawData ? JSON.parse(rawData) : {},
    };
};

const consumeEventStream = async (response, handlers) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        blocks.filter(Boolean).forEach((block) => {
            const { event, data } = parseEventBlock(block);
            handlers[event]?.(data);
        });

        if (done) {
            if (buffer.trim()) {
                const { event, data } = parseEventBlock(buffer);
                handlers[event]?.(data);
            }
            return;
        }
    }
};

const submitStreamingForm = async (form) => {
    const endpoint = form.getAttribute("hx-post");
    if (!endpoint || !isChatMessageRequest(form)) {
        return false;
    }

    const streamEndpoint = `${endpoint}/stream`;
    const formData = new FormData(form);
    let assistantTextElement = null;

    toggleLoader(true);
    toggleAiProcessing(true);
    updateAiProcessingStatus({
        title: "Нейросеть думает",
        text: "Готовлю контекст и отправляю запрос модели.",
        step: 1,
    });

    try {
        const response = await fetch(streamEndpoint, {
            method: "POST",
            body: formData,
            headers: {
                Accept: "text/event-stream",
            },
        });

        if (!response.ok || !response.body) {
            throw new Error(`HTTP ${response.status}`);
        }

        await consumeEventStream(response, {
            user: appendUserMessage,
            status: updateAiProcessingStatus,
            assistant_start: (data) => {
                assistantTextElement = createAssistantStreamMessage(data);
            },
            delta: ({ text }) => {
                if (!assistantTextElement) {
                    assistantTextElement = createAssistantStreamMessage({});
                }
                assistantTextElement.textContent += text || "";
                scrollChatToBottom();
            },
            refresh: ({ html }) => {
                const shell = document.getElementById("page-shell");
                if (shell && html) {
                    shell.outerHTML = html;
                }
            },
            error: ({ text }) => {
                updateAiProcessingStatus({
                    title: "Не удалось получить ответ",
                    text: text || "Попробуйте повторить запрос.",
                    step: 3,
                });
            },
        });

        return true;
    } catch (error) {
        updateAiProcessingStatus({
            title: "Потоковый ответ не запустился",
            text: "Запрос не был отправлен. Проверьте соединение и попробуйте ещё раз.",
            step: 3,
        });
        console.error(error);
        return false;
    } finally {
        toggleLoader(false);
        toggleAiProcessing(false);
        setupComposer();
    }
};

const setupStreamingForms = () => {
    document.querySelectorAll("form[hx-post]").forEach((form) => {
        if (!isChatMessageRequest(form) || form.dataset.streamingReady) {
            return;
        }

        form.dataset.streamingReady = "true";
        form.addEventListener(
            "submit",
            (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                void submitStreamingForm(form);
            },
            { capture: true },
        );
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
