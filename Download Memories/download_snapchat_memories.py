#!/usr/bin/env python3
"""
Download Snapchat memories with metadata from memories_history.json
Saves each memory with its associated metadata (date, location, type)
"""

import json
import os
import requests
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse
import sys
import mimetypes
import zipfile
import io

# Magic bytes for common file types
MAGIC_BYTES = {
    b'\xff\xd8\xff': 'jpg',      # JPEG
    b'\x89\x50\x4e\x47': 'png',  # PNG
    b'\x47\x49\x46': 'gif',      # GIF
    b'\x00\x00\x00\x18\x66\x74\x79\x70': 'mp4',  # MP4 variant 1
    b'\x00\x00\x00\x20\x66\x74\x79\x70': 'mp4',  # MP4 variant 2
    b'\x00\x00\x00\x24\x66\x74\x79\x70': 'mp4',  # MP4 variant 3
    b'\x00\x00\x00\x1c\x66\x74\x79\x70': 'mp4',  # MP4 variant 4
    b'\x00\x00\x00\x28\x66\x74\x79\x70': 'mp4',  # MP4 variant 5
}

def load_memories_json(json_path):
    """Load the memories history JSON file"""
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
        return data.get('Saved Media', [])
    except FileNotFoundError:
        print(f"Error: JSON file not found at {json_path}")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON format in {json_path}")
        sys.exit(1)

def detect_file_type(data):
    """Detect actual file type from magic bytes"""
    for magic, ext in MAGIC_BYTES.items():
        if data.startswith(magic):
            return ext
    return None

def extract_from_zip(zip_data, output_dir, date_part, index):
    """Extract all media files from ZIP data"""
    try:
        zip_buffer = io.BytesIO(zip_data)
        with zipfile.ZipFile(zip_buffer, 'r') as zip_ref:
            file_list = zip_ref.namelist()
            if not file_list:
                return []
            
            extracted_files = []
            
            # Extract all files from the ZIP
            for file_idx, filename in enumerate(file_list):
                file_data = zip_ref.read(filename)
                
                # Detect the actual file type
                detected_ext = detect_file_type(file_data)
                if detected_ext is None:
                    # Try to infer from filename
                    ext = Path(filename).suffix.lstrip('.')
                    detected_ext = ext if ext else 'jpg'
                
                # Create a descriptive filename
                # First file is usually main media, others are overlays
                if file_idx == 0:
                    suffix = "main"
                else:
                    suffix = f"overlay_{file_idx}"
                
                final_file = output_dir / f"{date_part}_{index}_{suffix}.{detected_ext}"
                
                # Save the file
                with open(final_file, 'wb') as f:
                    f.write(file_data)
                
                extracted_files.append((str(final_file), detected_ext))
            
            return extracted_files
    except zipfile.BadZipFile:
        return []
    except Exception as e:
        print(f"Error extracting ZIP: {e}")
        return []

def is_valid_media_files(extracted_files):
    """Check if extracted files are valid media"""
    if not extracted_files:
        return False
    
    for file_path, ext in extracted_files:
        try:
            file_size = os.path.getsize(file_path)
            if file_size < 1000:
                return False
        except:
            return False
    
    return True

def create_safe_filename(date_str, index):
    """Create a safe filename from date"""
    # Parse date and create filename
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S %Z")
        date_part = dt.strftime("%Y%m%d_%H%M%S")
    except:
        date_part = date_str.replace(" ", "_").replace(":", "")
    
    return date_part, index

def save_metadata(file_path, memory_data):
    """Save metadata as a JSON sidecar file"""
    metadata = {
        'Date': memory_data.get('Date'),
        'Media Type': memory_data.get('Media Type'),
        'Location': memory_data.get('Location'),
    }
    
    metadata_path = file_path.replace(Path(file_path).suffix, '.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

def download_memory(download_url, output_dir, memory_data, index, timeout=30):
    """Download a single memory file with validation"""
    try:
        date_str = memory_data.get('Date', 'unknown')
        media_type = memory_data.get('Media Type', 'unknown')
        
        print(f"  Downloading...", end="", flush=True)
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        response = requests.get(download_url, timeout=timeout, stream=False, headers=headers)
        response.raise_for_status()
        
        # Get the downloaded data
        downloaded_data = response.content
        content_type = response.headers.get('content-type', '').lower()
        
        # Create filename base
        date_part, idx = create_safe_filename(date_str, index)
        
        extracted_files = []
        
        # Check if it's a ZIP file
        if downloaded_data.startswith(b'PK\x03\x04'):
            # Try to extract from ZIP
            extracted_files = extract_from_zip(downloaded_data, output_dir, date_part, idx)
        
        # If not a ZIP or extraction failed, use the data directly
        if not extracted_files:
            # Detect file type from magic bytes
            detected_ext = detect_file_type(downloaded_data)
            
            if detected_ext is None:
                detected_ext = 'mp4' if media_type.lower() == 'video' else 'jpg'
            
            final_file = output_dir / f"{date_part}_{idx}.{detected_ext}"
            
            # Save the file
            with open(final_file, 'wb') as f:
                f.write(downloaded_data)
            
            extracted_files = [(str(final_file), detected_ext)]
        
        # Validate the files
        if not is_valid_media_files(extracted_files):
            print(f" ✗ (Invalid files)")
            # Clean up invalid files
            for file_path, _ in extracted_files:
                if os.path.exists(file_path):
                    os.remove(file_path)
            return False
        
        # Save metadata (linked to all files in the set)
        save_metadata(extracted_files[0][0], memory_data)
        
        # Show what was extracted
        file_count = len(extracted_files)
        if file_count > 1:
            print(f" ✓ ({file_count} files: main + {file_count-1} overlay)")
        else:
            ext = extracted_files[0][1].upper()
            print(f" ✓ ({ext})")
        return True
        
    except requests.exceptions.RequestException as e:
        print(f" ✗ (Network error: {str(e)[:40]})")
        return False
    except Exception as e:
        print(f" ✗ (Error: {str(e)[:40]})")
        return False

def main():
    # Get the directory of this script
    script_dir = Path(__file__).parent
    
    # Look for memories_history.json in the same directory or in a json subdirectory
    json_path = script_dir / "memories_history.json"
    if not json_path.exists():
        json_path = script_dir / "json" / "memories_history.json"
    
    # Create output directory
    output_dir = script_dir / "snapchat_memories"
    output_dir.mkdir(exist_ok=True)
    
    print(f"📱 Snapchat Memories Downloader")
    print(f"Reading from: {json_path}")
    print(f"Saving to: {output_dir}\n")
    
    # Load memories
    memories = load_memories_json(json_path)
    
    if not memories:
        print("No memories found in JSON file")
        sys.exit(0)
    
    print(f"Found {len(memories)} memories to download\n")
    
    # Download each memory
    successful = 0
    failed = 0
    
    for index, memory in enumerate(memories, 1):
        date = memory.get('Date', 'unknown')
        media_type = memory.get('Media Type', 'unknown')
        location = memory.get('Location', 'unknown')
        download_url = memory.get('Media Download Url')
        
        if not download_url:
            print(f"[{index}/{len(memories)}] Skipping: No download URL found")
            continue
        
        print(f"[{index}/{len(memories)}] {media_type}")
        print(f"  Date: {date}")
        print(f"  Location: {location}")
        
        # Download the file
        if download_memory(download_url, output_dir, memory, index):
            successful += 1
        else:
            failed += 1
    
    # Summary
    print(f"\n{'='*50}")
    print(f"Download Complete!")
    print(f"Successfully downloaded: {successful}/{len(memories)}")
    if failed > 0:
        print(f"Failed/Invalid: {failed}")
    print(f"Output directory: {output_dir}")
    print(f"{'='*50}")

if __name__ == "__main__":
    # Check if requests library is installed
    try:
        import requests
    except ImportError:
        print("Error: 'requests' library not found")
        print("Install it with: pip install requests")
        sys.exit(1)
    
    main()
