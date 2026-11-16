# AccessSignal - Implementation Plan

## Problem Statement

People with mobility and sensory disabilities face significant challenges navigating public spaces due to inadequate, fragmented, or non-existent accessibility information. Existing mapping solutions often lack detailed accessibility data, don't account for real-world barriers (temporary obstructions, broken elevators, blocked ramps), and don't provide routing that considers different mobility requirements. Infrastructure managers lack tools to identify, prioritize, and resolve accessibility issues systematically.

**AccessSignal** solves this by creating an open-source accessibility intelligence platform that combines community-sourced observations with OpenStreetMap data, local AI classification, accessibility-aware routing, and infrastructure management tools.

---

## Requirements Summary

Based on the comprehensive project brief:

1. **Map-first discovery** of accessibility information with filtering by accessibility needs
2. **Multimodal reporting** (photos, voice, text) with local AI classification via LM Studio
3. **Accessibility intelligence engine** for duplicate detection, confidence scoring, and hotspot identification
4. **Accessibility-aware routing** considering wheelchair access, stairs, inclines, and known barriers
5. **Place accessibility profiles** with verified information and evidence trails
6. **Infrastructure management dashboard** for issue tracking and resolution workflow
7. **Analytics module** for hotspot identification and trend analysis
8. **WCAG 2.2 AA compliance** with keyboard navigation, screen reader support, and accessible map alternatives
9. **Zero-cost operation** using only open-source technologies with no paid dependencies
10. **Anti-AI visual design** following the provided design directive with selective 3D elements

---

## Technical Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | React 18 + TypeScript + Vite | Fast builds, excellent DX, strong ecosystem |
| Styling | Tailwind CSS + CSS Modules | 8px spacing system, accessible contrast, design tokens |
| 3D Graphics | Three.js + React Three Fiber + Drei | Selective 3D elements, lazy-loaded, graceful fallback |
| Mapping | MapLibre GL JS | Open-source vector tiles, no API key required |
| Backend | FastAPI + Pydantic | High performance, automatic OpenAPI docs, async support |
| Database | PostgreSQL + PostGIS | Industry standard for geospatial data |
| Auth | JWT + bcrypt | Simple local auth, no external dependencies |
| AI | LM Studio OpenAI-compatible API | Uses existing local Gemma 4 12B model at E:\LM Studio\lmstudio-community\gemma-4-12B-it-QAT-GGUF |
| Routing | Custom graph + OSM data | Transparent algorithm, accessibility-weighted edges |
| File Storage | Local filesystem with abstraction | Zero-cost, configurable for S3 later |

### Demo Geographic Area

**Manhattan Core (Midtown & Lower Manhattan)** - Dense urban environment with:
- Major transit hubs (Penn Station, Grand Central, subway stations)
- Hospitals and medical facilities
- Tourist attractions and public spaces
- Mix of historic and modern infrastructure
- Real accessibility challenges (crowded sidewalks, construction, varying infrastructure age)

---

## System Architecture

`
+------------------------------------------------------------------------------+
|                              ACCESSSIGNAL ARCHITECTURE                       |
+------------------------------------------------------------------------------+

  +------------------------------------------------------------------------+   |
  |                           FRONTEND (React + Vite)                      |   |
  |  +------------+ +------------+ +------------+ +------------+           |   |
  |  |  Discovery | |  Reporting | |   Routing  | |  Management|           |   |
  |  |     Map    | |    Flow    | |   Engine   | |  Dashboard |           |   |
  |  +------+-----+ +------+-----+ +------+-----+ +------+-----+           |   |
  |         |               |               |               |              |   |
  |  +------+---------------+---------------+---------------+------+       |   |
  |  |              Shared Components & State Layer          |              |   |
  |  |  +------------+ +------------+ +------------+         |              |   |
  |  |  | MapLibre   | |  Three.js  | |   Access-  |         |              |   |
  |  |  |   Core     | |   Layer    | |  ibility   |         |              |   |
  |  |  +------------+ +------------+ +------------+         |              |   |
  |  +----------------------------------------------------------------+       |   |
  +------------------------------------------------------------------------+   |
                                      |                                         |
                                      v                                         |
  +------------------------------------------------------------------------+   |
  |                         BACKEND (FastAPI)                               |   |
  |  +------------+ +------------+ +------------+ +------------+           |   |
  |  |    Auth    | |   Reports  | |   Routing  | |    Places  |           |   |
  |  |   Service  | |   Service  | |   Service  | |   Service  |           |   |
  |  +------+-----+ +------+-----+ +------+-----+ +------+-----+           |   |
  |         |               |               |               |              |   |
  |  +------+---------------+---------------+---------------+------+       |   |
  |  |                    Intelligence Layer                       |       |   |
  |  |  +------------+ +------------+ +------------+              |       |   |
  |  |  |   AI       | |  Duplicate | | Confidence |              |       |   |
  |  |  | Classifier | |  Detector  | |  Scorer    |              |       |   |
  |  |  +------+-----+ +------------+ +------------+              |       |   |
  |  |        |                                                    |       |   |
  |  |        v                                                    |       |   |
  |  |  +--------------------------------------------+            |       |   |
  |  |  |  LM Studio API (Gemma 4 12B)               |            |       |   |
  |  |  |  localhost:1234/v1                         |            |       |   |
  |  |  +--------------------------------------------+            |       |   |
  |  +----------------------------------------------------------------+       |   |
  +------------------------------------------------------------------------+   |
                                      |                                         |
                                      v                                         |
  +------------------------------------------------------------------------+   |
  |                    DATA LAYER (PostgreSQL + PostGIS)                    |   |
  |  +------------+ +------------+ +------------+ +------------+           |   |
  |  |   Users    | |   Reports  | |    OSM     | |   Routes   |           |   |
  |  |   & Auth   | |   & Issues | |   Import   | |   & Paths  |           |   |
  |  +------------+ +------------+ +------------+ +------------+           |   |
  +------------------------------------------------------------------------+   |
                                                                                 |
  +------------------------------------------------------------------------+   |
  |                    EXTERNAL DATA SOURCES                                |   |
  |  +------------+ +------------+ +------------+                          |   |
  |  | OpenStreet-| |  Map Tiles  | |   Reverse  |                          |   |
  |  |     Map    | |  (OSM.org)  | |   Geocode  |                          |   |
  |  |  Overpass  | |  Nominatim  | |  Nominatim |                          |   |
  |  +------------+ +------------+ +------------+                          |   |
  +------------------------------------------------------------------------+   |
+------------------------------------------------------------------------------+
`

---

## Data Model

### Core Tables

**USERS**
- id (UUID, PK)
- email (string, UK)
- password_hash (string)
- display_name (string)
- role (string: user, admin, infrastructure_manager)
- created_at (timestamp)
- last_login (timestamp)

**REPORTS**
- id (UUID, PK)
- user_id (UUID, FK)
- location (geometry)
- category (string)
- subcategory (string)
- status (string)
- severity_score (float)
- confidence_score (float)
- description (text)
- ai_analysis (text)
- user_confirmed (boolean)
- reported_at (timestamp)
- resolved_at (timestamp)

**EVIDENCE**
- id (UUID, PK)
- report_id (UUID, FK)
- type (string: photo, voice, text)
- file_path (string)
- transcription (text)
- metadata (json)
- created_at (timestamp)

**PLACES**
- id (UUID, PK)
- location (geometry)
- osm_id (string, UK)
- name (string)
- place_type (string)
- accessibility_profile (json)
- last_verified (timestamp)
- verification_status (string)

**PLACE_ACCESSIBILITY**
- id (UUID, PK)
- place_id (UUID, FK)
- feature_type (string)
- status (string)
- source_report_id (UUID, FK)
- confidence (float)
- assessed_at (timestamp)

**ISSUES**
- id (UUID, PK)
- report_id (UUID, FK)
- assigned_to (UUID, FK)
- status (string: reported, under_review, confirmed, assigned, in_progress, resolved, reverification)
- priority (string: low, medium, high, critical)
- resolution_notes (text)
- resolution_evidence_id (UUID, FK)
- created_at (timestamp)
- updated_at (timestamp)
- resolved_at (timestamp)

**ISSUE_HISTORY**
- id (UUID, PK)
- issue_id (UUID, FK)
- changed_by (UUID, FK)
- old_status (string)
- new_status (string)
- notes (text)
- changed_at (timestamp)

**PATH_EDGES**
- id (UUID, PK)
- geom (geometry)
- from_node (UUID)
- to_node (UUID)
- accessibility_attributes (json)
- wheelchair_cost (float)
- walking_cost (float)
- source (string)

**HOTSPOTS**
- id (UUID, PK)
- area (geometry)
- severity_index (float)
- report_count (int)
- dominant_category (string)
- calculated_at (timestamp)

---

## Task Breakdown

### Phase 1: Foundation & Design System

#### Task 1: Project Setup and Repository Structure
- Initialize monorepo with frontend, backend, shared packages
- Create Vite + React + TypeScript project in frontend/
- Initialize FastAPI project in backend/
- Create docker-compose.yml for local development
- Create .env.example with all configuration variables
- Set up ESLint, Prettier, and TypeScript strict mode

#### Task 2: Design System and Component Library
- Define design tokens in Tailwind config: colors, typography, spacing (8px system)
- Create color palette: warm off-white background, charcoal text, muted borders, civic accent
- Implement typography scale with editorial heading font and readable body font
- Build base components: Button, Input, Select, Card, Badge, Modal, Skeleton
- Create layout components: Container, Grid, Stack, Sidebar, Header, Footer
- Implement focus states and keyboard navigation styles

#### Task 3: Database Schema and Migrations
- Create Alembic migration system
- Implement all tables from the ERD
- Add spatial indexes using PostGIS
- Create seed data scripts for demo
- Implement soft delete for reports and issues

---

### Phase 2: Authentication & User Management

#### Task 4: Backend Authentication System
- Create user registration endpoint with email validation
- Implement password hashing with bcrypt
- Build JWT token generation and validation
- Create login/logout endpoints
- Implement refresh token rotation
- Add rate limiting on auth endpoints
- Create role-based access control (user, admin, infrastructure_manager)

#### Task 5: Frontend Authentication UI
- Create login page with email/password form
- Build registration page with password strength indicator
- Create protected route wrapper
- Build user context and session management
- Add persistent login with secure storage

---

### Phase 3: Accessibility Reporting Module

#### Task 6: Backend Report API
- Build report creation endpoint with location validation
- Implement file upload handling for photos
- Create evidence attachment system
- Build report listing with spatial filtering
- Implement report detail endpoint
- Create nearby reports endpoint using PostGIS

#### Task 7: AI Classification Service
- Create OpenAI-compatible client for LM Studio at localhost:1234/v1
- Build prompt templates for accessibility classification
- Implement image analysis for photo evidence
- Create text classification for descriptions
- Add graceful fallback when AI unavailable

#### Task 8: Frontend Report Creation Flow
- Create report form with location picker
- Implement photo upload with preview
- Build voice recording component (Web Audio API)
- Create text description input
- Add category selection with subcategory cascading
- Implement AI classification preview and user confirmation

#### Task 9: Report List and Detail Views
- Create report list component with infinite scroll
- Build spatial filtering by map bounds
- Implement category and status filters
- Create report detail page with evidence viewer

---

### Phase 4: Mapping & Discovery Module

#### Task 10: Map Component Foundation
- Initialize MapLibre map with OSM tiles (configurable)
- Create tile source configuration
- Implement map controls (zoom, pitch, bearing)
- Build location search with Nominatim
- Create user location detection
- Create accessible map alternatives (list view toggle)

#### Task 11: Accessibility Data Layers
- Create vector layer for reports
- Build clustered marker system
- Implement marker styling by category and status
- Create hover and click interactions
- Build popup component for quick preview
- Add filter controls for accessibility types

#### Task 12: Place Discovery Interface
- Create place search functionality
- Build place list view with accessibility badges
- Implement place detail sidebar
- Add accessibility feature icons
- Create verification status indicators
- Implement place type filtering with OSM data

#### Task 13: 3D Map Enhancement (Selective)
- Create Three.js scene for selected areas
- Build 3D building representations (where data available)
- Implement accessibility marker elevation
- Create smooth 2D/3D transition
- Add camera controls for 3D view
- Implement WebGL availability detection
- Create fallback to 2D when WebGL unavailable

---

### Phase 5: Routing Engine

#### Task 14: OSM Data Import and Graph Construction
- Download Manhattan OSM extract via Overpass API
- Parse OSM data with osmium/osmnx
- Build pedestrian network graph with NetworkX
- Extract accessibility attributes from tags
- Create edge costs for different mobility profiles
- Implement graph storage in PostGIS

#### Task 15: Accessibility-Aware Routing Algorithm
- Create routing request model with preferences
- Build Dijkstra/A* with weighted edges
- Implement wheelchair profile (avoid stairs, steep grades)
- Create reduced effort profile (minimize distance, prefer smooth surfaces)
- Build unknown segment penalty
- Implement multiple route generation
- Add route explanation generation

#### Task 16: Frontend Routing Interface
- Create route origin/destination inputs
- Build accessibility preference selector
- Implement route display on map
- Create turn-by-turn directions
- Add route segment details with accessibility info
- Build alternative route comparison

---

### Phase 6: Intelligence Engine

#### Task 17: Duplicate Detection Service
- Create spatial proximity detection (within 50m)
- Implement text similarity matching
- Build category matching logic
- Create duplicate confidence scoring
- Build duplicate suggestion endpoint

#### Task 18: Confidence and Quality Scoring
- Create evidence quality scorer
- Build corroboration counter (independent reports)
- Implement recency weighting
- Add source credibility factor
- Create confidence explanation generator

#### Task 19: Hotspot Detection
- Create spatial clustering algorithm
- Build severity aggregation
- Implement category grouping
- Create hotspot scoring
- Build temporal trend analysis

---

### Phase 7: Infrastructure Management

#### Task 20: Manager Dashboard Backend
- Build issue list endpoint with filtering
- Create issue assignment system
- Implement status transition validation
- Build resolution workflow
- Create audit trail endpoints
- Implement report export (CSV, JSON)

#### Task 21: Manager Dashboard Frontend
- Create dashboard overview with statistics
- Build issue table with sorting and filtering
- Implement issue detail view with evidence
- Create status update interface
- Build assignment dropdown
- Add resolution form with evidence upload

#### Task 22: Analytics Dashboard
- Create time series charts for issue trends
- Build category breakdown visualizations
- Implement resolution time metrics
- Create geographic heat map
- Build coverage analysis (areas lacking data)

---

### Phase 8: Place Profiles

#### Task 23: Place Profile Backend
- Create place profile generation from OSM
- Build profile enrichment from reports
- Implement verification status calculation
- Create profile update triggers

#### Task 24: Place Profile Frontend
- Create place profile page layout
- Build accessibility feature cards
- Implement evidence viewer for each feature
- Create verification timeline
- Add report issue quick action

---

### Phase 9: Testing & Quality

#### Task 25: Backend Test Suite
- Unit tests for all services
- Integration tests for API endpoints
- Property-based tests for routing
- Test fixtures for common scenarios
- Mock external services (LM Studio, OSM APIs)

#### Task 26: Frontend Test Suite
- Component tests with Testing Library
- Integration tests for key flows
- E2E tests with Playwright
- Accessibility tests with jest-axe

#### Task 27: Accessibility Audit
- Automated accessibility testing in CI
- Manual keyboard navigation testing
- Screen reader testing with NVDA/JAWS
- Color contrast verification
- Create docs/ACCESSIBILITY_AUDIT.md

---

### Phase 10: Documentation & Deployment

#### Task 28: API Documentation
- Automatic OpenAPI spec generation
- Request/response examples
- Interactive Swagger UI

#### Task 29: User Documentation
- Create user guide with screenshots
- Build developer setup guide
- Write architecture documentation

#### Task 30: Demo Data and Final Polish
- Generate realistic synthetic data
- Create narrative-driven demo scenarios
- Build demo reset script
- Final performance optimization

---

### Phase 11: Kiro Crew App

#### Task 31: Access Monitor Agent Specification
- Specify agent capabilities and tools
- Design structured output schemas
- Create tool definitions for backend integration
- Build agent prompts and instructions

#### Task 32: Access Monitor Implementation
- Create agent for new report intake
- Build evidence analysis agent
- Implement duplicate investigation agent
- Create hotspot analysis agent
- Build stale report follow-up agent

---

## Demo Data Narrative

The demo will tell a realistic story set in Manhattan:

1. **The Hospital Ramp Blockage** - A wheelchair ramp at NYU Langone Hospital eastern entrance is blocked by delivery trucks. Multiple users report it over two days. System detects duplicates, correlates evidence, high-confidence issue created.

2. **The Subway Elevator Outage** - The elevator at 34th Street-Herald Square station breaks down. A visually impaired user reports it. Routing engine updates to suggest alternative station entrances.

3. **The Missing Curb Cut** - A new sidewalk renovation at Union Square removed a curb cut, making the crosswalk inaccessible. A caregiver reports it with photos. Infrastructure manager assigns to DOT liaison.

4. **The Resolved Success** - A previously reported blocked ramp at Grand Central is marked resolved after maintenance. Evidence photos show cleared path. System requests community reverification.

5. **The Unknown Territory** - A residential block in Lower East Side has no accessibility data. Users encouraged to contribute observations.

---

## File Structure

`
accesssignal/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/         # Button, Input, Card, etc.
│   │   │   ├── map/            # MapLibre components
│   │   │   ├── reports/        # Report forms and views
│   │   │   ├── routing/        # Route planning UI
│   │   │   ├── places/         # Place profiles
│   │   │   └── management/     # Manager dashboard
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── stores/             # Zustand state management
│   │   ├── services/           # API clients
│   │   ├── utils/
│   │   ├── types/
│   │   └── styles/
│   ├── public/
│   │   └── assets/             # 3D models, images
│   ├── tests/
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   └── dependencies.py
│   │   ├── models/
│   │   ├── services/
│   │   │   ├── ai/
│   │   │   ├── routing/
│   │   │   └── intelligence/
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── security.py
│   │   │   └── database.py
│   │   └── utils/
│   ├── migrations/
│   ├── tests/
│   ├── scripts/
│   │   └── seed_demo.py
│   └── pyproject.toml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── ACCESSIBILITY_AUDIT.md
│   ├── DESIGN_AUDIT.md
│   ├── OPEN_SOURCE_AND_COST_AUDIT.md
│   ├── HACKATHON_STRATEGY.md
│   └── USER_GUIDE.md
├── scripts/
│   ├── osm_extract.py
│   └── setup_dev.sh
├── docker-compose.yml
├── .env.example
├── README.md
├── LICENSE
└── PROJECT_STATUS.md
`

---

## Key Design Decisions

1. **LM Studio Integration**: Using the OpenAI-compatible API endpoint (localhost:1234/v1) allows easy switching between models and provides a standard interface.

2. **Configurable Tile Source**: Default to OSM.org tiles for simplicity, but fully configurable via environment variable to support self-hosted tile servers.

3. **Graph-Based Routing**: Custom NetworkX-based routing provides full transparency and control over accessibility weights, unlike black-box routing services.

4. **Narrative Demo Data**: A realistic story helps judges understand the real-world application and demonstrates all features in context.

5. **Progressive Enhancement**: 3D elements are optional enhancements, not requirements. The application is fully functional in 2D.

---

## Environment Variables

Create .env file with:

`env
# Database
DATABASE_URL=postgresql://accesssignal:accesssignal@localhost:5432/accesssignal

# Backend
SECRET_KEY=your-secret-key-change-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# AI Service (LM Studio)
AI_API_BASE=http://localhost:1234/v1
AI_MODEL=gemma-4-12b-it-qat-gguf
AI_FALLBACK_ENABLED=true

# Map Tiles
MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
MAP_ATTRIBUTION=© OpenStreetMap contributors

# File Storage
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=10

# CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Demo Mode
DEMO_MODE=true
`

---

## Open Source Dependencies

All dependencies must comply with the zero-cost policy. See docs/OPEN_SOURCE_AND_COST_AUDIT.md for complete audit.

Key open-source technologies:
- React, TypeScript, Vite (MIT)
- MapLibre GL JS (BSD-3)
- Three.js / React Three Fiber (MIT)
- FastAPI, Pydantic (MIT)
- PostgreSQL + PostGIS (PostgreSQL License)
- NetworkX (BSD-3)
- Tailwind CSS (MIT)
- JWT (MIT)

---

*Generated: November 2026*
*Version: 1.0*
