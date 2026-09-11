#!/usr/bin/env python3
"""Ilm - Quran AI App Entry Point"""

import sys
from pathlib import Path

# Add the Ilm package to the path
sys.path.insert(0, str(Path(__file__).parent))

from app import app


def main():
    """Start the Ilm application."""
    print("Ilm - Quran AI App")
    print("======================================")
    print("Features:")
    print("  - AI chat interface for Quran questions")
    print("  - Verses search")
    print("  - AI recommendations")
    print("  - Multilingual support (Arabic, Urdu, English, etc.)")
    print("  - Separate hadith inference section")
    print()
    
    # Run the application
    # In a real scenario, this would start a web server or CLI
    print("Application ready. Access via the generated web interface.")


if __name__ == "__main__":
    main()
