import type { Provider } from './types'

export interface ProviderPreset {
  id: Provider
  name: string
  color: string
  letter: string
  regions: { id: string; name: string }[]
  // {region} is replaced by the region id
  endpoint: string
  forcePathStyle: boolean
  hint?: string
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'ovh',
    name: 'OVHcloud',
    color: '#123f6d',
    letter: 'O',
    endpoint: 'https://s3.{region}.io.cloud.ovh.net',
    forcePathStyle: false,
    regions: [
      { id: 'gra', name: 'Gravelines (gra)' },
      { id: 'sbg', name: 'Strasbourg (sbg)' },
      { id: 'rbx', name: 'Roubaix (rbx)' },
      { id: 'eu-west-par', name: 'Paris 3-AZ (eu-west-par)' },
      { id: 'de', name: 'Frankfurt (de)' },
      { id: 'uk', name: 'London (uk)' },
      { id: 'waw', name: 'Warsaw (waw)' },
      { id: 'bhs', name: 'Beauharnois (bhs)' },
      { id: 'ca-east-tor', name: 'Toronto (ca-east-tor)' },
      { id: 'sgp', name: 'Singapore (sgp)' },
      { id: 'ap-southeast-syd', name: 'Sydney (ap-southeast-syd)' }
    ],
    hint: 'Keys: OVHcloud Control Panel → Public Cloud → Users & Roles → S3 credentials.'
  },
  {
    id: 'aws',
    name: 'Amazon S3',
    color: '#d97706',
    letter: 'A',
    endpoint: '',
    forcePathStyle: false,
    regions: [
      { id: 'eu-west-3', name: 'Paris (eu-west-3)' },
      { id: 'eu-west-1', name: 'Ireland (eu-west-1)' },
      { id: 'eu-central-1', name: 'Frankfurt (eu-central-1)' },
      { id: 'eu-west-2', name: 'London (eu-west-2)' },
      { id: 'us-east-1', name: 'N. Virginia (us-east-1)' },
      { id: 'us-west-2', name: 'Oregon (us-west-2)' }
    ]
  },
  {
    id: 'scaleway',
    name: 'Scaleway',
    color: '#4f0599',
    letter: 'S',
    endpoint: 'https://s3.{region}.scw.cloud',
    forcePathStyle: false,
    regions: [
      { id: 'fr-par', name: 'Paris (fr-par)' },
      { id: 'nl-ams', name: 'Amsterdam (nl-ams)' },
      { id: 'pl-waw', name: 'Warsaw (pl-waw)' }
    ]
  },
  {
    id: 'wasabi',
    name: 'Wasabi',
    color: '#0a8f3c',
    letter: 'W',
    endpoint: 'https://s3.{region}.wasabisys.com',
    forcePathStyle: false,
    regions: [
      { id: 'eu-central-1', name: 'Amsterdam (eu-central-1)' },
      { id: 'eu-west-1', name: 'London (eu-west-1)' },
      { id: 'eu-west-2', name: 'Paris (eu-west-2)' },
      { id: 'us-east-1', name: 'N. Virginia (us-east-1)' }
    ]
  },
  {
    id: 'r2',
    name: 'Cloudflare R2',
    color: '#f38020',
    letter: 'R',
    endpoint: 'https://<account-id>.r2.cloudflarestorage.com',
    forcePathStyle: false,
    regions: [{ id: 'auto', name: 'auto' }],
    hint: 'Replace <account-id> with your Cloudflare account id.'
  },
  {
    id: 'minio',
    name: 'MinIO',
    color: '#c72e49',
    letter: 'M',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
    regions: [{ id: 'us-east-1', name: 'us-east-1' }]
  },
  {
    id: 'custom',
    name: 'Other S3-compatible',
    color: '#3d4556',
    letter: '',
    endpoint: '',
    forcePathStyle: false,
    regions: []
  }
]

export function preset(id?: Provider): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1]
}

export function endpointFor(p: ProviderPreset, region: string) {
  return p.endpoint.replace('{region}', region)
}
