# 💻 Development Setup

Want to modify the app or contribute? Here's how to get started:

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [Python 3.x](https://www.python.org/downloads/)
- Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/Project-Memories.git
   cd Project-Memories
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Set up Python environment (optional, for scripts):**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r python/requirements.txt
   ```

### Running in Development

**Start the Electron app:**
```bash
npm start
```

The app will launch in development mode with hot reloading.