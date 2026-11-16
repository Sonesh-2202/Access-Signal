import { Link } from 'react-router-dom'
import { apiUrl } from '@/services/api'
import { Wordmark } from './Wordmark'

export function Footer() {
  return (
    <footer className="mt-auto border-t border-hair">
      <div className="mx-auto grid max-w-page gap-4 px-2 py-6 sm:px-4 md:grid-cols-12">
        <div className="md:col-span-5">
          <Wordmark />
          <p className="mt-2 max-w-[40ch] text-sm text-muted">
            Community reports of accessibility barriers in Midtown and Lower Manhattan, checked, scored and routed
            around. Open source, runs on local hardware or free hosting.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm md:col-span-4 md:col-start-7">
          <Link to="/methodology">How scoring works</Link>
          <Link to="/accessibility">Accessibility statement</Link>
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/terms">Terms of service</Link>
          <a href={apiUrl('/api/docs')} target="_blank" rel="noreferrer">
            API documentation
          </a>
          <Link to="/report">Report a barrier</Link>
          <Link to="/settings">AI settings</Link>
        </nav>
        <p className="text-xs text-muted md:col-span-3 md:text-right">
          Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
          , ODbL. Tiles by{' '}
          <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a>
          . Search by Nominatim.
        </p>
      </div>
    </footer>
  )
}
