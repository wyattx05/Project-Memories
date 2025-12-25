#!/usr/bin/env python3
"""
Apply PNG overlay captions to Snapchat memories.
Takes media files with associated PNG overlays and composites them together,
replacing the original media file with the overlaid version.
"""

import os
import sys
from pathlib import Path
from PIL import Image
import subprocess
import json

def get_media_base_files(memories_dir):
    """
    Get all unique base filenames (without extension).
    Groups files like: 20251212_034909_6_main.mp4, 20251212_034909_6_overlay_1.png
    """
    files = {}
    
    for filename in os.listdir(memories_dir):
        filepath = os.path.join(memories_dir, filename)
        if not os.path.isfile(filepath):
            continue
        
        # Extract the base name (before _main, _overlay, or final extension)
        parts = filename.rsplit('.', 1)
        if len(parts) != 2:
            continue
        
        name, ext = parts
        
        # Skip JSON metadata files
        if ext.lower() == 'json':
            continue
        
        # Get base identifier (e.g., "20251212_034909_6" from "20251212_034909_6_main")
        if name.endswith('_main'):
            base_id = name[:-5]  # Remove "_main"
        elif '_overlay_' in name:
            base_id = name.split('_overlay_')[0]
        else:
            # File without _main or _overlay suffix, treat as standalone
            base_id = name
        
        if base_id not in files:
            files[base_id] = {'main': None, 'overlays': [], 'json': None}
        
        if name.endswith('_main'):
            files[base_id]['main'] = (filename, ext.lower())
        elif '_overlay_' in name:
            files[base_id]['overlays'].append((filename, ext.lower()))
        else:
            # Standalone file (no _main or _overlay)
            files[base_id]['main'] = (filename, ext.lower())
    
    return files

def apply_overlay_to_image(main_path, overlay_path, output_path):
    """Apply a PNG overlay to an image and save the result"""
    try:
        # Open the main image
        main_img = Image.open(main_path)
        
        # Open the overlay
        overlay_img = Image.open(overlay_path)
        
        # Ensure both images are in RGBA for proper alpha blending
        if main_img.mode != 'RGBA':
            main_img = main_img.convert('RGBA')
        
        if overlay_img.mode != 'RGBA':
            overlay_img = overlay_img.convert('RGBA')
        
        # Resize overlay to match main image dimensions if needed
        if overlay_img.size != main_img.size:
            overlay_img = overlay_img.resize(main_img.size, Image.Resampling.LANCZOS)
        
        # Composite the overlay onto the main image
        # The overlay's alpha channel controls transparency
        main_img = Image.alpha_composite(main_img, overlay_img)
        
        # Convert back to RGB for JPG output (if needed)
        if output_path.lower().endswith('.jpg'):
            # Create a white background for transparency
            background = Image.new('RGB', main_img.size, (255, 255, 255))
            background.paste(main_img, mask=main_img.split()[3] if main_img.mode == 'RGBA' else None)
            background.save(output_path, quality=95)
        else:
            # Keep RGBA for PNG
            main_img.save(output_path)
        
        return True
    except Exception as e:
        print(f"    Error applying overlay: {e}")
        return False

def apply_overlay_to_video(main_path, overlay_path, output_path, temp_frame_dir="temp_frames"):
    """
    Apply a PNG overlay to a video using ffmpeg.
    Creates an overlay filter that composites the PNG on top of each video frame.
    """
    try:
        # Use ffmpeg with overlay filter
        # Scale overlay to match video dimensions for proper encoding
        # Use -c:v copy for video codec to preserve original (faster) or libx264 for re-encoding
        
        cmd = [
            'ffmpeg',
            '-i', main_path,
            '-i', overlay_path,
            '-filter_complex',
            '[1:v]scale=iw:ih:force_original_aspect_ratio=decrease[overlay];[0:v][overlay]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:enable=\'between(t,0,n)\'',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-y',  # Overwrite output file
            output_path
        ]
        
        # Run ffmpeg
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=300  # 5 minute timeout per video
        )
        
        if result.returncode != 0:
            # Try alternative approach: scale overlay to match video dimensions exactly
            print(f"    Retrying with scaled overlay...", end="")
            
            # Get video dimensions first
            probe_cmd = [
                'ffprobe',
                '-v', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=width,height',
                '-of', 'csv=s=x:p=0',
                main_path
            ]
            
            try:
                probe_result = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, text=True)
                if probe_result.returncode == 0:
                    dimensions = probe_result.stdout.strip()
                    
                    cmd = [
                        'ffmpeg',
                        '-i', main_path,
                        '-i', overlay_path,
                        '-filter_complex',
                        f'[1:v]scale={dimensions}[overlay];[0:v][overlay]overlay=0:0',
                        '-c:v', 'libx264',
                        '-preset', 'fast',
                        '-c:a', 'aac',
                        '-b:a', '128k',
                        '-y',
                        output_path
                    ]
                    
                    result = subprocess.run(
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=300
                    )
                    
                    if result.returncode == 0:
                        print(" ✓")
                        return True
            except Exception as e:
                pass
            
            print(f"    FFmpeg error")
            return False
        
        return True
    except subprocess.TimeoutExpired:
        print(f"    Video processing timeout")
        return False
    except FileNotFoundError:
        print(f"    FFmpeg not found. Please install ffmpeg: brew install ffmpeg")
        return False
    except Exception as e:
        print(f"    Error applying overlay to video: {e}")
        return False

def process_memories(memories_dir):
    """Process all memories with overlays"""
    memories_dir = Path(memories_dir)
    
    if not memories_dir.exists():
        print(f"Error: Directory not found: {memories_dir}")
        return
    
    # Get all media files grouped by base ID
    media_files = get_media_base_files(str(memories_dir))
    
    if not media_files:
        print("No media files found to process")
        return
    
    total = len(media_files)
    processed_count = 0
    skipped_count = 0
    
    print(f"Found {total} unique media file(s)")
    print("-" * 60)
    
    for base_id, file_group in media_files.items():
        # Skip if no main media file
        if not file_group['main']:
            print(f"⊘ {base_id}: No main media file found")
            skipped_count += 1
            continue
        
        # Skip if no overlays
        if not file_group['overlays']:
            print(f"○ {base_id}: No overlays (skipped)")
            skipped_count += 1
            continue
        
        main_filename, main_ext = file_group['main']
        main_path = memories_dir / main_filename
        
        print(f"✓ {base_id}")
        print(f"  Main: {main_filename}")
        
        # Process each overlay
        for overlay_filename, overlay_ext in file_group['overlays']:
            overlay_path = memories_dir / overlay_filename
            
            if not overlay_path.exists():
                print(f"    Overlay not found: {overlay_filename}")
                continue
            
            print(f"  Applying: {overlay_filename}", end="")
            
            # Create temporary output path
            temp_output = memories_dir / f"{base_id}_with_overlay.{main_ext}"
            
            # Apply overlay based on media type
            if main_ext.lower() in ['jpg', 'jpeg', 'png']:
                success = apply_overlay_to_image(str(main_path), str(overlay_path), str(temp_output))
            elif main_ext.lower() in ['mp4', 'mov', 'avi']:
                success = apply_overlay_to_video(str(main_path), str(overlay_path), str(temp_output))
            else:
                print(f" (unsupported format: {main_ext})")
                continue
            
            if success:
                print(" ✓")
                
                # Replace original with overlaid version
                try:
                    os.replace(str(temp_output), str(main_path))
                    print(f"    Replaced original with overlaid version")
                    
                    # Delete the overlay file since it's now merged
                    overlay_path.unlink()
                    print(f"    Deleted overlay: {overlay_filename}")
                    
                    processed_count += 1
                except Exception as e:
                    print(f"    Error replacing file: {e}")
                    # Clean up temp file
                    if temp_output.exists():
                        temp_output.unlink()
            else:
                print(" ✗")
                # Clean up failed temp file
                if temp_output.exists():
                    temp_output.unlink()
        
        print()
    
    # Summary
    print("-" * 60)
    print(f"Processing complete!")
    print(f"  Processed: {processed_count}")
    print(f"  Skipped: {skipped_count}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        memories_dir = sys.argv[1]
    else:
        # Default to snapchat_memories folder in current directory
        memories_dir = "./snapchat_memories"
    
    print(f"Processing Snapchat memories in: {memories_dir}")
    print()
    
    process_memories(memories_dir)
