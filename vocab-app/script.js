/*
  Main script for the Vocabulary Builder PWA.
  Handles routing logic for the different pages (index, flashcards, dashboard, admin),
  reading and writing from localStorage, parsing CSV files, generating flash card
  sessions with distractors, spaced repetition behaviour, and updating progress.
*/

// Register the service worker for offline support
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('service-worker.js')
      .catch((err) => {
        console.error('Service worker registration failed:', err);
      });
  }
}

/**
 * Parse a CSV string into an array of word objects.
 * Expected CSV header: word,meaning,synonyms,antonyms,example
 * Synonyms and antonyms should be separated by semicolons.
 * Returns an array of objects: { word, meaning, synonyms: string[], antonyms: string[], example }
 * Blank lines are skipped.
 */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  // Remove header
  lines.shift();
  const words = [];
  for (const line of lines) {
    if (!line) continue;
    // Split only first 5 comma-separated values (commas inside fields not supported)
    const parts = line.split(/,(?![^\"]*\")/g);
    if (parts.length < 5) continue;
    const [word, meaning, synStr, antStr, example] = parts;
    const synonyms = synStr.split(/;|\|/).map((s) => s.trim()).filter(Boolean);
    const antonyms = antStr.split(/;|\|/).map((a) => a.trim()).filter(Boolean);
    words.push({
      word: word.trim(),
      meaning: meaning.trim(),
      synonyms,
      antonyms,
      example: example.trim(),
    });
  }
  return words;
}

/**
 * Shuffle an array in place using the Fisher–Yates algorithm.
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Generate distractor options for a given word entry.
 * Picks random synonyms from other words or their own synonyms (excluding the correct answer).
 * Ensures that options are unique and that the correct answer is included.
 */
function generateOptions(entry, allEntries) {
  const correct = entry.synonyms[0] || entry.meaning.split(' ')[0] || entry.word;
  // Collect candidate distractors from synonyms of other words
  const candidates = [];
  for (const other of allEntries) {
    if (other.word === entry.word) continue;
    candidates.push(...other.synonyms);
  }
  // Filter out empty strings and duplicates
  const candidateSet = new Set(candidates.filter((c) => c && c.toLowerCase() !== correct.toLowerCase()));
  const distractors = [];
  const candidateArray = Array.from(candidateSet);
  shuffleArray(candidateArray);
  for (const cand of candidateArray) {
    if (distractors.length >= 3) break;
    if (!entry.synonyms.some((s) => s.toLowerCase() === cand.toLowerCase())) {
      distractors.push(cand);
    }
  }
  // If not enough distractors, add random words from entries
  let i = 0;
  while (distractors.length < 3 && i < allEntries.length) {
    const otherWord = allEntries[i];
    if (otherWord.word !== entry.word && otherWord.word.toLowerCase() !== correct.toLowerCase()) {
      distractors.push(otherWord.word);
    }
    i++;
  }
  // In case duplicates or still not enough, ensure length is 3
  while (distractors.length < 3) {
    distractors.push('');
  }
  const options = [correct, ...distractors.slice(0, 3)];
  return shuffleArray(options);
}

/**
 * Retrieve words either from localStorage (custom upload) or the default CSV file.
 * Returns a promise that resolves to an array of entries.
 */
async function loadWords() {
  // Check custom words in localStorage
  const custom = localStorage.getItem('words');
  if (custom) {
    try {
      return JSON.parse(custom);
    } catch (e) {
      console.error('Failed to parse custom words:', e);
    }
  }
  // Fallback to default CSV
  try {
    const response = await fetch('data/default_words.csv');
    const text = await response.text();
    const words = parseCSV(text);
    return words;
  } catch (e) {
    console.error('Failed to load default words:', e);
    return [];
  }
}

/**
 * Get a random encouraging or congratulatory message.
 * Messages are kept short and positive.
 */
function getMotivationalMessage(isCorrect) {
  const successMessages = [
    'Great job!',
    'Correct! Keep it up!',
    'Awesome work!',
    'You nailed it!',
    'Excellent!',
  ];
  const errorMessages = [
    'Not quite. You can do it!',
    'Almost! Keep trying!',
    'Don’t worry, learn and move on!',
    'Keep going, you’ll get it next time!',
    'Mistakes help you learn!',
  ];
  const arr = isCorrect ? successMessages : errorMessages;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Update progress in localStorage.
 * Accepts the username and an array of results for the session.
 * Each result: { word, correct: boolean }
 */
function updateProgress(username, results) {
  if (!username) return;
  const key = 'progress';
  const existing = localStorage.getItem(key);
  let progress = {};
  if (existing) {
    try {
      progress = JSON.parse(existing);
    } catch (e) {
      console.error('Failed to parse existing progress:', e);
    }
  }
  if (!progress[username]) {
    progress[username] = {};
  }
  results.forEach((res) => {
    if (!progress[username][res.word]) {
      progress[username][res.word] = { attempts: 0, correct: 0 };
    }
    progress[username][res.word].attempts += 1;
    if (res.correct) {
      progress[username][res.word].correct += 1;
    }
  });
  localStorage.setItem(key, JSON.stringify(progress));
}

/**
 * Render the dashboard for the current user.
 */
function renderDashboard() {
  const username = localStorage.getItem('username') || '';
  const summaryEl = document.getElementById('dashboard-summary');
  const tableEl = document.getElementById('dashboard-table');
  if (!username) {
    summaryEl.textContent = 'Please go back and enter your name to begin.';
    return;
  }
  const progressRaw = localStorage.getItem('progress');
  if (!progressRaw) {
    summaryEl.textContent = 'No progress yet. Start learning to see your results.';
    return;
  }
  let progress;
  try {
    progress = JSON.parse(progressRaw);
  } catch (e) {
    summaryEl.textContent = 'Unable to load your progress.';
    return;
  }
  const userProgress = progress[username] || {};
  const words = Object.keys(userProgress);
  if (words.length === 0) {
    summaryEl.textContent = 'No progress yet. Start learning to see your results.';
    return;
  }
  let totalAttempts = 0;
  let totalCorrect = 0;
  words.forEach((w) => {
    totalAttempts += userProgress[w].attempts;
    totalCorrect += userProgress[w].correct;
  });
  const accuracy = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
  summaryEl.textContent = `${username}, you have studied ${words.length} words. You answered ${totalCorrect} out of ${totalAttempts} attempts correctly (${accuracy}% accuracy).`;
  // Build table
  let html = '<tr><th>Word</th><th>Attempts</th><th>Correct</th><th>Accuracy</th></tr>';
  words.forEach((w) => {
    const entry = userProgress[w];
    const acc = entry.attempts ? Math.round((entry.correct / entry.attempts) * 100) : 0;
    html += `<tr><td>${w}</td><td>${entry.attempts}</td><td>${entry.correct}</td><td>${acc}%</td></tr>`;
  });
  tableEl.innerHTML = html;
}

/**
 * Render the student progress overview in the admin panel.
 */
function renderAdminProgress() {
  const container = document.getElementById('admin-progress');
  const raw = localStorage.getItem('progress');
  if (!raw) {
    container.innerHTML = '<p>No student progress recorded yet.</p>';
    return;
  }
  let progress;
  try {
    progress = JSON.parse(raw);
  } catch (e) {
    container.innerHTML = '<p>Unable to parse progress data.</p>';
    return;
  }
  const students = Object.keys(progress);
  if (students.length === 0) {
    container.innerHTML = '<p>No student progress recorded yet.</p>';
    return;
  }
  let html = '<table class="dashboard-table"><tr><th>Student</th><th>Words Learned</th><th>Total Attempts</th><th>Correct Answers</th><th>Accuracy</th></tr>';
  students.forEach((student) => {
    const entries = progress[student];
    const words = Object.keys(entries);
    let attempts = 0;
    let correct = 0;
    words.forEach((w) => {
      attempts += entries[w].attempts;
      correct += entries[w].correct;
    });
    const acc = attempts ? Math.round((correct / attempts) * 100) : 0;
    html += `<tr><td>${student}</td><td>${words.length}</td><td>${attempts}</td><td>${correct}</td><td>${acc}%</td></tr>`;
  });
  html += '</table>';
  container.innerHTML = html;
}

/**
 * Initialize the index page: handle name input and start button.
 */
function initIndex() {
  const nameInput = document.getElementById('username-input');
  const startBtn = document.getElementById('start-btn');
  // Prefill name if previously stored
  const storedName = localStorage.getItem('username');
  if (storedName) {
    nameInput.value = storedName;
  }
  startBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Guest';
    localStorage.setItem('username', name);
    // Navigate to learning page
    window.location.href = 'flashcards.html';
  });
}

/**
 * Initialize the flashcards page.
 */
async function initFlashcards() {
  const flashcardContainer = document.getElementById('flashcard-container');
  const wordEl = document.getElementById('flashcard-word');
  const optionsEl = document.getElementById('options-container');
  const detailsEl = document.getElementById('details-container');
  const messageEl = document.getElementById('message-container');
  const nextBtn = document.getElementById('next-btn');
  const progressEl = document.getElementById('progress');
  const username = localStorage.getItem('username') || 'Guest';
  const allWords = await loadWords();
  if (!allWords || allWords.length === 0) {
    flashcardContainer.style.display = 'block';
    wordEl.textContent = 'No words available.';
    return;
  }
  // Prepare session: pick up to 10 unique random entries
  const entries = [...allWords];
  shuffleArray(entries);
  const session = entries.slice(0, Math.min(10, entries.length)).map((entry) => {
    const options = generateOptions(entry, allWords);
    return { entry, options, correct: entry.synonyms[0] || entry.word };
  });
  // Keep queue for spaced repetition
  const queue = [...session];
  const results = [];
  let currentCard = null;
  function showCard() {
    detailsEl.classList.remove('visible');
    messageEl.textContent = '';
    nextBtn.style.display = 'none';
    // Reset previous option event listeners by clearing container
    optionsEl.innerHTML = '';
    if (queue.length === 0) {
      finishSession();
      return;
    }
    currentCard = queue.shift();
    const { entry, options } = currentCard;
    flashcardContainer.style.display = 'block';
    wordEl.textContent = entry.word;
    progressEl.textContent = `Remaining: ${queue.length + 1}`;
    options.forEach((opt) => {
      const btn = document.createElement('div');
      btn.className = 'option';
      btn.textContent = opt;
      btn.addEventListener('click', () => handleOptionClick(btn, opt, currentCard));
      optionsEl.appendChild(btn);
    });
  }
  function handleOptionClick(buttonEl, selectedOption, card) {
    // Disable clicking further
    const optionNodes = optionsEl.querySelectorAll('.option');
    optionNodes.forEach((node) => {
      node.style.pointerEvents = 'none';
    });
    const correctText = card.correct;
    const isCorrect = selectedOption.toLowerCase() === correctText.toLowerCase();
    // Highlight the clicked option
    if (isCorrect) {
      buttonEl.classList.add('correct');
    } else {
      buttonEl.classList.add('incorrect');
    }
    // Highlight the correct option
    optionNodes.forEach((node) => {
      if (node.textContent.toLowerCase() === correctText.toLowerCase()) {
        node.classList.add('correct');
      }
    });
    // Show details
    detailsEl.innerHTML = '';
    const meaningEl = document.createElement('div');
    meaningEl.innerHTML = `<span class="label">Meaning:</span> ${card.entry.meaning}`;
    const synEl = document.createElement('div');
    synEl.innerHTML = `<span class="label">Synonyms:</span> ${card.entry.synonyms.join(', ')}`;
    const antEl = document.createElement('div');
    antEl.innerHTML = `<span class="label">Antonyms:</span> ${card.entry.antonyms.join(', ')}`;
    const exEl = document.createElement('div');
    exEl.innerHTML = `<span class="label">Example:</span> ${card.entry.example}`;
    detailsEl.appendChild(meaningEl);
    detailsEl.appendChild(synEl);
    detailsEl.appendChild(antEl);
    detailsEl.appendChild(exEl);
    detailsEl.classList.add('visible');
    // Message
    messageEl.textContent = getMotivationalMessage(isCorrect);
    // Record result
    results.push({ word: card.entry.word, correct: isCorrect });
    // Spaced repetition: wrong answers are queued again
    if (!isCorrect) {
      // Clone card to avoid modifying original object reference
      queue.push({ entry: card.entry, options: generateOptions(card.entry, allWords), correct: card.correct });
    }
    nextBtn.style.display = 'inline-block';
  }
  function finishSession() {
    // Update progress
    updateProgress(username, results);
    // Show final message
    flashcardContainer.style.display = 'none';
    nextBtn.style.display = 'none';
    progressEl.textContent = '';
    messageEl.textContent = '';
    detailsEl.classList.remove('visible');
    const summary = document.createElement('div');
    summary.className = 'card';
    const correctCount = results.filter((r) => r.correct).length;
    summary.innerHTML = `<h3 style="text-align:center;">Session Complete</h3><p>You answered ${correctCount} out of ${results.length} correctly.</p>`;
    const againBtn = document.createElement('button');
    againBtn.className = 'button';
    againBtn.textContent = 'Return to Dashboard';
    againBtn.style.marginTop = '1rem';
    againBtn.addEventListener('click', () => {
      window.location.href = 'dashboard.html';
    });
    summary.appendChild(againBtn);
    // Clear main and append summary
    const main = document.querySelector('main');
    main.innerHTML = '';
    main.appendChild(summary);
  }
  nextBtn.addEventListener('click', () => {
    showCard();
  });
  // Start session by showing first card
  showCard();
}

/**
 * Initialise the admin page: handle login, CSV upload, and display student progress.
 */
function initAdmin() {
  const loginSection = document.getElementById('admin-login');
  const adminSection = document.getElementById('admin-section');
  const loginBtn = document.getElementById('admin-login-btn');
  const passwordInput = document.getElementById('admin-password');
  const uploadBtn = document.getElementById('upload-btn');
  const csvInput = document.getElementById('csv-file');
  const wordPreview = document.getElementById('word-preview');
  const ADMIN_PASSWORD = 'admin123';
  loginBtn.addEventListener('click', () => {
    if (passwordInput.value === ADMIN_PASSWORD) {
      loginSection.style.display = 'none';
      adminSection.style.display = 'block';
      renderAdminProgress();
    } else {
      alert('Incorrect password');
    }
  });
  uploadBtn.addEventListener('click', () => {
    const file = csvInput.files ? csvInput.files[0] : null;
    if (!file) {
      alert('Please select a CSV file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const entries = parseCSV(text);
      if (entries.length === 0) {
        alert('No entries found in the CSV file.');
        return;
      }
      // Save to localStorage
      localStorage.setItem('words', JSON.stringify(entries));
      // Show preview summary
      wordPreview.innerHTML = `<p>Uploaded ${entries.length} words successfully.</p>`;
    };
    reader.readAsText(file);
  });
}

// Handle page initialisation based on dataset-page attribute
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  const page = document.body.dataset.page;
  switch (page) {
    case 'index':
      initIndex();
      break;
    case 'flashcards':
      initFlashcards();
      break;
    case 'dashboard':
      renderDashboard();
      document.getElementById('learn-again').addEventListener('click', () => {
        window.location.href = 'flashcards.html';
      });
      break;
    case 'admin':
      initAdmin();
      break;
    default:
      break;
  }
});