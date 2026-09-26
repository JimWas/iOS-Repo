import Link from "next/link";
import data from "../../data/packages.json";
type Package = {slug:string;name:string;icon?:string;category:string;priceCents:number;summary:string};
const packages = data as Package[];
export const metadata = {title:"Packages | JimWas Repo"};
export default function Packages(){return <main className="catalog"><div className="catalog-nav"><Link href="/">← JimWas Repo</Link></div><p className="eyebrow">THE COLLECTION</p><h1>All packages</h1><p>Free and paid tweaks from JimWas Repo.</p>{packages.length ? <div className="cards">{packages.map((item)=><Link href={`/packages/${item.slug}`} className="card" key={item.slug}><div className="card-icon">{item.icon?.startsWith("/")?<img src={item.icon} alt=""/>:item.icon||"✦"}</div><div className="card-meta">{item.category}<b>{item.priceCents?`$${(item.priceCents/100).toFixed(2)}`:"Free"}</b></div><h3>{item.name}</h3><p>{item.summary}</p><span>View package →</span></Link>)}</div>:<div className="empty"><h2>No packages published yet</h2><p>Check back for the first release.</p></div>}</main>}
