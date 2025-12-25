#!/usr/bin/env python3
"""
Add Location Names to Snapchat Memories JSON Files

This script reads JSON files from a Snapchat Memories export, extracts coordinates
from the Location field, performs reverse geocoding to get place names, and adds
a "Location Name" field to each JSON file.

Usage:
    python add_location_names.py <memories_folder>

Example:
    python add_location_names.py /path/to/memories
"""

import json
import os
import sys
import time
import argparse
from pathlib import Path
import requests


def extract_coordinates(location_string):
    """
    Extract latitude and longitude from location string.
    
    Args:
        location_string (str): Location string like "Latitude, Longitude: 37.54, -77.44"
    
    Returns:
        tuple: (lat, lon) or None if not found
    """
    if not location_string or "Latitude, Longitude:" not in location_string:
        return None
    
    try:
        # Extract coordinates from string
        coords = location_string.split("Latitude, Longitude:")[1].strip()
        lat, lon = coords.split(",")
        return float(lat.strip()), float(lon.strip())
    except (ValueError, IndexError):
        return None


def reverse_geocode(lat, lon):
    """
    Get place name from coordinates using Nominatim API with precise location details.
    
    Args:
        lat (float): Latitude
        lon (float): Longitude
    
    Returns:
        str: Place name or None if geocoding fails
    """
    try:
        url = f"https://nominatim.openstreetmap.org/reverse"
        params = {
            "format": "json",
            "lat": lat,
            "lon": lon,
            "zoom": 18,  # Building level detail
            "addressdetails": 1,
            "extratags": 1,  # Get extra tags like amenity types
            "namedetails": 1  # Get name variants
        }
        headers = {
            "User-Agent": "SnapchatMemoriesLocationAdder/1.0"
        }
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            
            if "address" in data:
                address = data["address"]
                display_name = data.get("display_name", "")
                place_type = data.get("type", "")
                osm_type = data.get("osm_type", "")
                
                # Debug: Print available address components
                print(f"    Type: {place_type}, Available: {', '.join(address.keys())}")
                
                # Build precise location name with hierarchical approach
                location_parts = []
                
                # TIER 1: Most specific - POI, Building, or Venue
                specific_place = None
                
                # Check for specific POI/amenity names
                if "amenity" in address:
                    specific_place = address["amenity"]
                elif "shop" in address:
                    specific_place = address["shop"]
                elif "leisure" in address:
                    specific_place = address["leisure"]
                elif "tourism" in address:
                    specific_place = address["tourism"]
                elif "building" in address and address["building"] not in ["yes", "residential"]:
                    specific_place = address["building"]
                
                # Use the actual name if available (like "Starbucks", "Central Park")
                if "name" in data and data["name"]:
                    location_parts.append(data["name"])
                elif specific_place:
                    # Capitalize and format the amenity type
                    formatted = specific_place.replace("_", " ").title()
                    location_parts.append(formatted)
                
                # TIER 2: Street/Road level for more context
                road = None
                if "road" in address:
                    road = address["road"]
                elif "pedestrian" in address:
                    road = address["pedestrian"]
                elif "path" in address:
                    road = address["path"]
                
                # TIER 3: Neighborhood/Area
                area = None
                if "neighbourhood" in address:
                    area = address["neighbourhood"]
                elif "suburb" in address:
                    area = address["suburb"]
                elif "quarter" in address:
                    area = address["quarter"]
                elif "borough" in address:
                    area = address["borough"]
                elif "hamlet" in address:
                    area = address["hamlet"]
                
                # TIER 4: City/Municipality
                city = None
                if "city" in address:
                    city = address["city"]
                elif "town" in address:
                    city = address["town"]
                elif "village" in address:
                    city = address["village"]
                elif "municipality" in address:
                    city = address["municipality"]
                
                # TIER 5: State/Region
                state = address.get("state")
                
                # TIER 6: Country (for international locations)
                country_code = address.get("country_code", "").upper()
                country = address.get("country")
                
                # Smart assembly based on what we have
                if len(location_parts) == 0:
                    # No specific place name, start with road
                    if road:
                        location_parts.append(road)
                    
                # Add area if we have it and it's different from city
                if area and (not city or area.lower() != city.lower()):
                    if road and area:
                        # If we have road, only add area if it adds value
                        location_parts.append(area)
                    elif not road:
                        location_parts.append(area)
                
                # Always add city if available
                if city:
                    location_parts.append(city)
                
                # Add state for US locations or major region for others
                if state and country_code == "US":
                    # For US, use state abbreviation if possible
                    state_abbrev = {
                        "California": "CA", "Texas": "TX", "Florida": "FL",
                        "New York": "NY", "Virginia": "VA", "North Carolina": "NC",
                        "Georgia": "GA", "Illinois": "IL", "Pennsylvania": "PA",
                        "Ohio": "OH", "Michigan": "MI", "Washington": "WA"
                        # Add more as needed
                    }.get(state, state)
                    location_parts.append(state_abbrev)
                elif state and country_code != "US":
                    location_parts.append(state)
                
                # Add country for non-US locations
                if country and country_code != "US":
                    location_parts.append(country)
                
                if location_parts:
                    return ", ".join(location_parts)
        
        return None
    
    except Exception as e:
        print(f"  ⚠️  Geocoding error: {e}")
        return None


def process_memories_folder(folder_path, force=False):
    """
    Process all JSON files in the memories folder and add location names.
    
    Args:
        folder_path (str): Path to the memories folder
        force (bool): If True, re-process files even if they already have location names
    """
    folder = Path(folder_path)
    
    if not folder.exists() or not folder.is_dir():
        print(f"❌ Error: '{folder_path}' is not a valid directory")
        return
    
    # Find all JSON files
    json_files = list(folder.rglob("*.json"))
    
    if not json_files:
        print(f"❌ No JSON files found in '{folder_path}'")
        return
    
    print(f"Found {len(json_files)} JSON files")
    print("Starting to add location names...\n")
    
    processed = 0
    skipped = 0
    errors = 0
    
    # Track unique locations to avoid repeated geocoding
    location_cache = {}
    
    for json_file in json_files:
        try:
            # Read JSON file
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Check if already has location name (skip unless force mode)
            if "Location Name" in data and not force:
                print(f"⏭️  Skipping {json_file.name} (already has location name)")
                skipped += 1
                continue
            
            # Extract coordinates
            location_str = data.get("Location", "")
            coords = extract_coordinates(location_str)
            
            if not coords:
                print(f"⏭️  Skipping {json_file.name} (no coordinates)")
                data["Location Name"] = "Unknown location"
                skipped += 1
            else:
                lat, lon = coords
                coord_key = f"{round(lat, 2)},{round(lon, 2)}"
                
                # Check cache first
                if coord_key in location_cache:
                    location_name = location_cache[coord_key]
                    print(f"✓ {json_file.name}: {location_name} (cached)")
                else:
                    # Geocode with rate limiting (1 request per second)
                    time.sleep(1)
                    
                    location_name = reverse_geocode(lat, lon)
                    
                    if location_name:
                        location_cache[coord_key] = location_name
                        print(f"✓ {json_file.name}: {location_name}")
                    else:
                        # Fallback to formatted coordinates
                        lat_dir = "N" if lat >= 0 else "S"
                        lon_dir = "E" if lon >= 0 else "W"
                        location_name = f"{abs(lat):.2f}°{lat_dir}, {abs(lon):.2f}°{lon_dir}"
                        location_cache[coord_key] = location_name
                        print(f"⚠️  {json_file.name}: {location_name} (geocoding failed)")
                
                data["Location Name"] = location_name
                processed += 1
            
            # Write updated JSON back to file
            with open(json_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        
        except Exception as e:
            print(f"❌ Error processing {json_file.name}: {e}")
            errors += 1
    
    # Summary
    print(f"\n{'='*50}")
    print(f"Processing complete!")
    print(f"  Processed: {processed}")
    print(f"  Skipped: {skipped}")
    print(f"  Errors: {errors}")
    print(f"{'='*50}")


def main():
    parser = argparse.ArgumentParser(
        description="Add location names to Snapchat Memories JSON files using reverse geocoding.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python add_location_names.py ~/Downloads/snapchat_memories
  python add_location_names.py ~/Downloads/snapchat_memories --force
"""
    )
    
    parser.add_argument(
        "memories_folder",
        help="Path to the folder containing Snapchat Memories files"
    )
    
    parser.add_argument(
        "-f", "--force",
        action="store_true",
        help="Re-process files even if they already have location names (useful after script improvements)"
    )
    
    args = parser.parse_args()
    
    process_memories_folder(args.memories_folder, force=args.force)


if __name__ == "__main__":
    main()
