// === CONFIGURAÇÕES GERAIS ===
const CONFIG = {
    YOUR_EMAIL: "lucastiago@jbfdigital.com.br", 
    GITHUB_PROFILE: "https://github.com/lucasmarchidea", 
    TOAST_DELAY_MS: 800,       // Tempo para aparecer o "Obrigado"
    TIMEOUT_LIMIT_MS: 15000,   // Tempo limite para desistir de uma URL
    CONCURRENCY_LIMIT: 3       // Quantas abas abre ao mesmo tempo
};

// === Elementos da Tela (DOM) ===
const textarea = document.getElementById("urls");
const resultsDiv = document.getElementById("results");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const counter = document.getElementById("counter");
const validateBtn = document.getElementById("validateBtn");
const btnClear = document.getElementById("btnClear"); // Botão Limpar

const toggleExportBtn = document.getElementById("toggleExportBtn");
const exportMenu = document.getElementById("exportMenu");
const btnTxt = document.getElementById("btnTxt");
const btnCsv = document.getElementById("btnCsv");

let results = [];

// === 1. MEMÓRIA: Carregar dados ao abrir ===
document.addEventListener('DOMContentLoaded', () => {
    // Carrega o que foi digitado antes
    document.getElementById("country").value = localStorage.getItem("tv_country") || "";
    document.getElementById("vertical").value = localStorage.getItem("tv_vertical") || "";
    document.getElementById("pagetype").value = localStorage.getItem("tv_pagetype") || "";
    document.getElementById("urls").value = localStorage.getItem("tv_urls") || "";

    // Tenta carregar os resultados da última validação
    const savedResults = localStorage.getItem("tv_results");
    if (savedResults) {
        try {
            results = JSON.parse(savedResults);
            if (results.length > 0) {
                renderResults(); // Desenha na tela
                updateProgressUI(100, "Concluído!");
                // Se tem resultado, mostra o botão de baixar
                document.querySelector('.export-section').style.display = 'flex';
            }
        } catch (e) {
            console.error("Erro ao carregar memória", e);
        }
    }
});

// === 2. MEMÓRIA: Salvar enquanto digita ===
const inputsToSave = ['country', 'vertical', 'pagetype', 'urls'];
inputsToSave.forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
        localStorage.setItem(`tv_${id}`, e.target.value);
    });
});

// === 3. BOTÃO LIMPAR ===
btnClear.onclick = () => {
    if(confirm("Deseja limpar todos os campos e resultados?")) {
        // Limpa os campos visuais
        inputsToSave.forEach(id => document.getElementById(id).value = "");
        
        // Limpa a memória do navegador
        inputsToSave.forEach(id => localStorage.removeItem(`tv_${id}`));
        localStorage.removeItem("tv_results");

        // Reseta a interface (some com os resultados)
        results = [];
        resultsDiv.innerHTML = "";
        counter.innerHTML = "";
        updateProgressUI(0, "0%");
        progressBar.classList.remove("finished");
        exportMenu.style.display = "none";
    }
};

// === FUNÇÃO PRINCIPAL: Valida uma única URL ===
async function validateUrl(url) {
    // Pega os filtros atuais
    const expected = {
        country: document.getElementById("country").value.trim().toLowerCase(),
        vertical: document.getElementById("vertical").value.trim().toLowerCase(),
        pagetype: document.getElementById("pagetype").value.trim().toLowerCase()
    };

    if (!expected.country && !expected.vertical && !expected.pagetype) {
        return { url, status: "error", message: "⚠ Preencha os filtros de validação!" };
    }

    let tabId = null;

    try {
        // Abre a aba sem focar nela (segundo plano)
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;

        // Espera o site carregar completamente
        await new Promise((resolve) => {
            const listener = (tid, info) => {
                if (tid === tabId && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            // Trava de segurança: se demorar muito, desiste
            setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, CONFIG.TIMEOUT_LIMIT_MS);
        });

        // Script que entra no site e busca as tags. "window.tags"
        const getTags = async () => {
            for (let i = 0; i < 5; i++) { 
                const r = await chrome.scripting.executeScript({
                    target: { tabId },
                    world: "MAIN",
                    func: () => {
                        const t = window.tags; 
                        if (!t) return null;
                        
                        // Se for uma lista (Array)
                        if (Array.isArray(t)) {
                            return { type: 'list', data: t.map(item => String(item).trim().toLowerCase()) };
                        }
                        // Se for um objeto { country: "us" ... }
                        return {
                            type: 'object',
                            data: {
                                country: String(t.country || "").toLowerCase(),
                                vertical: String(t.vertical || "").toLowerCase(),
                                pagetype: String(t.pageType || t.pagetype || "").toLowerCase()
                            }
                        };
                    }
                }).catch(() => null);

                if (r && r[0] && r[0].result) return r[0].result;
                await new Promise(res => setTimeout(res, 800)); // Espera um pouquinho e tenta de novo
            }
            return null;
        };

        const result = await getTags();
        chrome.tabs.remove(tabId); // Fecha a aba

        if (!result) return { url, status: "error", message: "Tags não encontradas" };

        let errors = [];
        let data = result.data;

        // === LÓGICA DE NEGÓCIO (CENSURADA PARA PORTFÓLIO) ===
        /* NOTA DO DESENVOLVEDOR:
           Aqui é onde toda a mágica da lógica funciona, e obviamente eu censurei essa parte, ferramenta exclusiva do time de AdOps JBF!
        */

        // Validação Simplificada (Apenas para demonstração)
        if (expected.country && data.country !== expected.country) {
            errors.push(`Country incorreto`);
        }
        if (expected.vertical && data.vertical !== expected.vertical) {
            errors.push(`Vertical incorreta`);
        }
        if (expected.pagetype && data.pagetype !== expected.pagetype) {
            errors.push(`PageType incorreto`);
        }

        if (errors.length > 0) return { url, status: "error", message: errors.join(" | ") };
        else return { url, status: "ok", message: "OK" };

    } catch (e) {
        if (tabId) try { chrome.tabs.remove(tabId); } catch(err){}
        return { url, status: "error", message: "Erro: " + e.message };
    }
}

// === Renderiza a Lista na Tela ===
function renderResults() {
    // Ordena: Erros primeiro, Sucessos depois
    results.sort((a, b) => a.status === "error" ? -1 : 1);
    resultsDiv.innerHTML = "";
    let okCount = 0;

    results.forEach(r => {
        const div = document.createElement("div");
        div.className = `result-item ${r.status} fade-in`;
        if (r.status === "error") {
             div.innerHTML = `<div class="icon">❌</div><div class="info"><strong>${r.url}</strong><span class="err-msg">${r.message}</span></div>`;
        } else {
             div.innerHTML = `<div class="icon">✅</div><div class="info">${r.url}</div>`;
        }
        resultsDiv.appendChild(div);
        if (r.status === "ok") okCount++;
    });

    const errCount = results.length - okCount;
    counter.innerHTML = `
        <span class="counter-text">${results.length} URLs</span>
        ${okCount > 0 ? `<span class="badge-ok">${okCount} OK</span>` : ''}
        ${errCount > 0 ? `<span class="badge-err">${errCount} Erros</span>` : ''}
    `;
}

function updateProgressUI(percentage, text) {
    progressBar.style.width = percentage + "%";
    progressText.innerText = text;
    if (percentage === 100) progressBar.classList.add("finished");
    else progressBar.classList.remove("finished");
}

// === BOTÃO VALIDAR: Onde tudo começa ===
validateBtn.onclick = async () => {
    const rawLines = textarea.value.split("\n");
    const urls = [];

    // Verificação de segurança: É uma URL válida?
    for (let line of rawLines) {
        line = line.trim();
        if (!line) continue; 
        if (!line.startsWith("http://") && !line.startsWith("https://")) {
            alert(`URL inválida detectada: \n\n"${line}"\n\nCertifique-se de usar "http://" ou "https://"`);
            textarea.focus(); 
            return; 
        }
        urls.push(line);
    }

    if (!urls.length) return alert("Insira URLs para validar.");
    
    // Verifica se tem filtros
    const hasFilter = ['country', 'vertical', 'pagetype'].some(id => document.getElementById(id).value.trim());
    if(!hasFilter) return alert("Defina pelo menos um filtro de validação.");

    // Reseta estado para nova rodada
    results = [];
    resultsDiv.innerHTML = "<div class='loading-state'>Iniciando validação em lote...</div>";
    exportMenu.style.display = "none";
    updateProgressUI(0, "0%");
    counter.innerHTML = "";
    localStorage.removeItem("tv_results"); // Limpa resultado anterior

    // Controle de filas (Concorrência)
    let currentIndex = 0;
    let completedCount = 0;

    const worker = async () => {
        while (currentIndex < urls.length) {
            const i = currentIndex++; 
            const url = urls[i];
            const res = await validateUrl(url);
            results.push(res);
            completedCount++;

            const pct = Math.round((completedCount / urls.length) * 100);
            updateProgressUI(pct, `${completedCount}/${urls.length}`);
            renderResults();
        }
    };

    // Cria os "trabalhadores" simultâneos
    const workers = [];
    const numWorkers = Math.min(CONFIG.CONCURRENCY_LIMIT, urls.length);
    for (let k = 0; k < numWorkers; k++) workers.push(worker());

    await Promise.all(workers);

    updateProgressUI(100, "Concluído!");
    
    // Salva o resultado final na memória
    localStorage.setItem("tv_results", JSON.stringify(results));
    
    // Dispara o "Obrigado"
    setTimeout(showToast, CONFIG.TOAST_DELAY_MS);
};

// === Exportação e Downloads ===
toggleExportBtn.onclick = () => { exportMenu.style.display = exportMenu.style.display === "none" ? "grid" : "none"; };

function getFailedTags(message) {
    let tags = [];
    const msg = message.toLowerCase();
    if (msg.includes("country")) tags.push("Country");
    if (msg.includes("vertical")) tags.push("Vertical");
    if (msg.includes("pagetype")) tags.push("PageType");
    return tags.length > 0 ? tags.join(", ") : "Geral";
}

btnTxt.onclick = () => {
    const errors = results.filter(r => r.status === "error");
    if (!errors.length) return alert("Todas as tags estão corretas, uhu!");
    const content = errors.map(r => `[${getFailedTags(r.message)}] ${r.url} -> ${r.message}`).join("\n");
    downloadFile(content, "erros_tags.txt", "text/plain");
};

btnCsv.onclick = () => {
    const errors = results.filter(r => r.status === "error");
    if (!errors.length) return alert("Todas as tags estão corretas, uhu!");
    let content = "Tags com Erro,URL,Mensagem de Erro\n";
    errors.forEach(r => content += `"${getFailedTags(r.message)}","${r.url}","${r.message}"\n`);
    downloadFile("\uFEFF" + content, "erros_tags.csv", "text/csv;charset=utf-8;");
};

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
}

// === Atalhos de Teclado (Ctrl + Enter) ===
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') validateBtn.click();
});

// === Modal de Feedback ===
const modal = document.getElementById("feedbackModal");
document.getElementById("btnOpenFeedback").onclick = (e) => { e.preventDefault(); modal.style.display = "flex"; };
document.getElementById("btnCloseFeedback").onclick = () => { modal.style.display = "none"; };

document.getElementById("btnSendFeedback").onclick = () => {
    const name = document.getElementById("fbName").value.trim();
    const email = document.getElementById("fbEmail").value.trim();
    const message = document.getElementById("fbMessage").value.trim();

    if (!name || !email) return alert("Por favor, preencha nome e e-mail.");

    const subject = encodeURIComponent(`Feedback Tag Validator - ${name}`);
    const body = encodeURIComponent(`Nome: ${name}\nEmail: ${email}\n\nMensagem:\n${message}`);
    const mailToUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${CONFIG.YOUR_EMAIL}&su=${subject}&body=${body}`;

    chrome.tabs.create({ url: mailToUrl });
    modal.style.display = "none";
};

// === Links Externos (GitHub) ===
document.getElementById("authorLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: CONFIG.GITHUB_PROFILE });
});

// === Mensagem de Obrigado (Toast) ===
function showToast() {
    const toast = document.getElementById("toastMessage");
    toast.className = "toast show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 4000);
}