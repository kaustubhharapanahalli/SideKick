// options.js - API Key Management

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('status');

  // Load existing API key
  chrome.storage.sync.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
  });

  // Save API key
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    
    // Quick validation (Gemini keys usually start with AIza)
    if (key && !key.startsWith('AIza')) {
      statusMsg.style.color = '#ef4444'; // red
      statusMsg.textContent = 'Invalid key format. Should start with AIza...';
      statusMsg.classList.add('show');
      setTimeout(() => statusMsg.classList.remove('show'), 3000);
      return;
    }

    chrome.storage.sync.set({ geminiApiKey: key }, () => {
      statusMsg.style.color = '#10b981'; // green
      statusMsg.textContent = 'Settings saved successfully!';
      statusMsg.classList.add('show');
      
      // Flash effect on button
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saved!';
      saveBtn.style.backgroundColor = '#10b981';
      
      setTimeout(() => {
        statusMsg.classList.remove('show');
        saveBtn.textContent = originalText;
        saveBtn.style.backgroundColor = '';
      }, 2000);
    });
  });
});
