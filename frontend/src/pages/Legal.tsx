import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Container } from '@/components/layout/Layout'
import { useDocumentTitle } from '@/hooks/useAsync'

interface Section {
  id: string
  title: string
  body: ReactNode
}

function Document({ eyebrow, title, updated, intro, sections }: { eyebrow: string; title: string; updated: string; intro: ReactNode; sections: Section[] }) {
  useDocumentTitle(title)
  return (
    <Container className="grid gap-4 py-6 md:grid-cols-12 md:py-8">
      <header className="md:col-span-8 md:col-start-4">
        <p className="meta">{eyebrow}</p>
        <h1 className="mt-1 text-4xl leading-snug tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-sm text-muted">Last updated {updated}</p>
        <div className="mt-3 max-w-prose text-lg leading-relaxed">{intro}</div>
      </header>
      <nav aria-label="On this page" className="md:col-span-3 md:row-start-2">
        <div className="md:sticky md:top-[96px]">
          <p className="meta mb-1">On this page</p>
          <ol className="flex flex-col border-l border-hair text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block py-0.5 pl-2 text-muted no-underline hover:text-ink">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
      <div className="md:col-span-7 md:col-start-4 md:row-start-2">
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-[96px] border-t border-hair py-3">
            <h2 className="text-2xl leading-snug">{s.title}</h2>
            <div className="mt-1 flex max-w-prose flex-col gap-2 leading-relaxed [&_li]:ml-3 [&_li]:list-disc">{s.body}</div>
          </section>
        ))}
      </div>
    </Container>
  )
}

export function Terms() {
  return (
    <Document
      eyebrow="Legal"
      title="Terms of service"
      updated="November 16, 2026"
      intro={<p>These terms cover your use of AccessSignal, a community project that collects reports of accessibility barriers in Midtown and Lower Manhattan.</p>}
      sections={[
        { id: 'service', title: 'What the service is', body: <><p>AccessSignal publishes reports from the public, scores how confident we are in each one, and uses them to suggest walking and rolling routes. It is an information service. It is not an emergency service and it is not operated by the City of New York or the MTA.</p><p>For urgent hazards call 911. For non-emergency city issues use 311.</p></> },
        { id: 'accuracy', title: 'Accuracy of information', body: <><p>Conditions change quickly. A ramp reported clear an hour ago may be blocked now. Every report and route shows when its data was last confirmed, and routes flag sections with missing data.</p><p>Use your own judgement on site. We don't guarantee that any route, entrance or facility is accessible.</p></> },
        { id: 'your-reports', title: 'Your reports', body: <><p>You keep ownership of photos, voice notes and text you submit. By submitting, you give AccessSignal a non-exclusive licence to publish them on the service and to share them with infrastructure staff who fix the problem.</p><p>Only report what you have seen yourself. Don't upload photos where people's faces are the subject, and don't include personal details of others in descriptions.</p></> },
        { id: 'conduct', title: 'Acceptable use', body: <ul><li>No false or misleading reports.</li><li>No harassment of businesses, staff or other reporters.</li><li>No automated bulk submissions or scraping beyond the published API limits.</li><li>No attempts to access staff tools without a staff account.</li></ul> },
        { id: 'moderation', title: 'Moderation', body: <p>Staff may reject, merge or remove reports that are duplicates, inaccurate or break these terms. Removed reports are hidden from the public site but kept in the staff audit trail.</p> },
        { id: 'open-data', title: 'Open data and licences', body: <p>Map and path data come from OpenStreetMap and are available under the Open Database License. The AccessSignal source code is MIT licensed.</p> },
        { id: 'changes', title: 'Changes to these terms', body: <p>We'll post changes here and note the date at the top. Material changes are announced on the home page for 30 days.</p> },
      ]}
    />
  )
}

export function Privacy() {
  return (
    <Document
      eyebrow="Legal"
      title="Privacy policy"
      updated="November 16, 2026"
      intro={<p>We collect the minimum needed to make reports trustworthy and fixable. Nothing is sold, and no third-party analytics or advertising scripts run on this site.</p>}
      sections={[
        { id: 'collect', title: 'What we collect', body: <ul><li>Account: email, display name, a bcrypt hash of your password.</li><li>Reports: the location you choose, category, description, and any photos or voice notes you attach.</li><li>Sign-in records: refresh token hashes and their expiry, used to keep you signed in and to detect stolen sessions.</li></ul> },
        { id: 'photos', title: 'Photos and location metadata', body: <p>Photos often carry the GPS position and device model in their EXIF data. We strip EXIF and XMP metadata from JPEG uploads before storing them. The only location kept is the one you set on the report.</p> },
        { id: 'ai', title: 'AI classification', body: <p>Photos and text you submit for a suggestion, and questions you ask the assistant, are sent to a cloud AI provider: your own key’s provider if you add one, otherwise a server-configured provider. If no cloud model answers, a rule-based classifier is used instead. The assistant only reads public reports, places and routes, and it cannot change anything.</p> },
        { id: 'third-parties', title: 'Third-party services', body: <><p>Map tiles load from OpenFreeMap and address search uses OpenStreetMap's Nominatim service. Both receive your IP address and the map area or search text, as with any website request. Neither receives your account details.</p></> },
        { id: 'public', title: 'What is public', body: <p>Reports, their evidence, your display name and the time of the report are public. Your email address is never shown.</p> },
        { id: 'retention', title: 'Retention and deletion', body: <p>You can remove your own reports at any time. They are hidden from the site immediately and kept only in the staff audit trail. To delete your account and its reports entirely, contact the operators of this deployment. Resolved reports are otherwise kept as part of the public repair record.</p> },
        { id: 'storage', title: 'Storage on your device', body: <p>We store one item in your browser: a refresh token that keeps you signed in. It goes in local storage if you choose "keep me signed in", otherwise in session storage, which clears when you close the tab. There are no tracking cookies.</p> },
      ]}
    />
  )
}

export function AccessibilityStatement() {
  return (
    <Document
      eyebrow="Accessibility"
      title="Accessibility statement"
      updated="November 16, 2026"
      intro={<p>AccessSignal is built for people who rely on accessible infrastructure, so the site itself targets WCAG 2.2 level AA. This page describes how we meet it and where we know we fall short.</p>}
      sections={[
        { id: 'measures', title: 'What we do', body: <ul><li>Every page works with a keyboard alone, with a visible focus ring and a skip link.</li><li>The map is never the only way to get information. The map page has a list view, routes come with written directions, and charts have data tables.</li><li>Severity and status are shown with shape and text as well as colour.</li><li>Text meets at least 4.5:1 contrast; body text is 15:1.</li><li>Touch targets are at least 44 by 44 pixels.</li><li>Animation is brief and turns off when your system asks for reduced motion.</li><li>Voice notes can be transcribed live in supporting browsers, and transcripts are stored with the report.</li></ul> },
        { id: 'known', title: 'Known limitations', body: <ul><li>The map canvas itself can be panned with arrow keys, but individual markers are not focusable. Use the list view to reach every report.</li><li>The 3D views are decorative enhancements and are hidden from assistive technology.</li><li>Live speech transcription depends on the browser's speech recognition and is not available in Firefox.</li></ul> },
        { id: 'testing', title: 'How we test', body: <p>Automated checks with axe-core run in the component test suite. The manual test plan covers keyboard-only use, NVDA and JAWS on Windows, VoiceOver on iOS, 200% and 400% zoom, and a 320px wide viewport. Which checks have been completed, and what they found, is recorded in docs/ACCESSIBILITY_AUDIT.md in the source repository.</p> },
        { id: 'feedback', title: 'Feedback', body: <p>If something on this site is a barrier for you, report it like any other barrier: choose the category "Other" and describe the page. Staff see these reports in the same queue as street reports.</p> },
      ]}
    />
  )
}

export function Methodology() {
  return (
    <Document
      eyebrow="Methodology"
      title="How reports are scored and routed"
      updated="November 16, 2026"
      intro={<p>Every number on AccessSignal can be traced back to the reports behind it. This page explains the formulas, so you can decide how much to rely on them.</p>}
      sections={[
        { id: 'confidence', title: 'Confidence score', body: <><p>Confidence estimates how likely it is that a barrier exists right now. It is a weighted sum of four factors, each between 0 and 1:</p><ul><li><strong>Evidence (35%)</strong>: photo 0.45, voice note 0.2, a description of 40+ characters 0.15, and agreement with the AI classification up to 0.2.</li><li><strong>Independent reports (30%)</strong>: other people reporting the same category within 50 m in 30 days. One corroboration gives 0.5, two give 0.75, three give 0.875.</li><li><strong>Recency (15%)</strong>: halves every 14 days.</li><li><strong>Reporter history (20%)</strong>: the share of a reporter's past reports that staff confirmed, starting at 0.5 for new reporters. Staff reports count 0.9.</li></ul></> },
        { id: 'duplicates', title: 'Duplicate detection', body: <p>A new report is compared with open reports within 50 m from the last 30 days. The match score is 40% proximity, 40% category agreement and 20% text similarity (cosine similarity of the words used, with common synonyms like "lift" and "elevator" merged). Scores above 0.5 are offered to the reporter as possible duplicates. Reporters decide; nothing is merged automatically.</p> },
        { id: 'routing', title: 'Routing', body: <><p>Routes run over the OpenStreetMap pedestrian network. Each path segment has a cost in metres of effective distance, never less than its real length.</p><ul><li><strong>Wheelchair</strong>: stairs, raised kerbs and paths tagged not accessible are excluded. Slopes above 5%, 8% and 10% multiply the cost by 1.8, 4 and 8. Rough surfaces multiply by 3. A reported barrier that blocks wheelchairs, with severity of at least 0.75 and confidence of at least 0.35, closes the segment.</li><li><strong>Reduced effort</strong>: stairs triple the cost; slopes and rough surfaces add proportionally.</li><li><strong>Low vision</strong>: crossings without a confirmed audible signal, stairs without tactile warnings and unlit paths cost more.</li><li><strong>Unknown data</strong>: each missing attribute (surface, kerb height, tactile paving) adds 15%, or 60% when "avoid unknown segments" is on.</li></ul><p>Alternatives are found by penalising the segments of earlier routes and searching again, keeping only routes that differ by at least a quarter of their segments.</p></> },
        { id: 'hotspots', title: 'Hotspots', body: <p>Open reports from the last 90 days are clustered with DBSCAN (120 m radius, at least 2 reports). A hotspot's severity index is the average confidence-weighted severity multiplied by 1 − e^(−n/3), so one report can't form a severe hotspot by itself. Trend compares the last 14 days with the 14 before.</p> },
        { id: 'ai', title: 'AI classification', body: <><p>When you ask for a suggestion, a cloud model reads the description and photos and suggests a category, severity and short summary. You always see the suggestion, which provider produced it, and choose the final category yourself. When no cloud model is available a keyword classifier takes over and the result is marked as keyword-based.</p><p>The assistant answers questions about one report, place or route, or about how AccessSignal works. It answers in text from the public data on screen and cites what it used. It cannot file, change, verify or resolve anything.</p><p>Which provider runs depends on how AccessSignal is hosted. The public demo uses free cloud tiers: Google Gemini (text and photos) or Groq (text only). Free tiers may use submitted content to improve the provider’s products, so don’t include personal details in reports or in assistant questions. The report form and the assistant tell you where your text goes before you send anything.</p><p>If you add your own AI key in Settings, it stays in your browser tab, is sent with each suggestion or assistant request, and is not stored by AccessSignal.</p></> },
        { id: 'source', title: 'Source code', body: <p>Scoring lives in <code className="font-mono text-sm">backend/app/services/intelligence</code> and routing in <code className="font-mono text-sm">backend/app/services/routing</code>. See the <Link to="/accessibility">accessibility statement</Link> for how the interface itself is tested.</p> },
      ]}
    />
  )
}
