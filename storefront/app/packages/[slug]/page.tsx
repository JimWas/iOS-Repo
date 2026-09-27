import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import data from "../../../data/packages.json";
type Package = {slug:string;packageId?:string;videoId?:string;name:string;icon?:string;banner?:string;category:string;priceCents:number;summary:string;description?:string;version?:string;ios?:string;architecture?:string;filename?:string};
const packages = data as Package[];
export function generateStaticParams(){return packages.map((item)=>({slug:item.slug}))}
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{
  const {slug}=await params;
  const item=packages.find((value)=>value.slug===slug);
  if(!item)return {};
  const title=`${item.name} — ${item.priceCents?`$${(item.priceCents/100).toFixed(2)} USD`:"Free"}`;
  const description=`${item.summary} ${item.ios??""}`.trim();
  const image=item.banner??item.icon;
  return {
    title,
    description,
    alternates:{canonical:`/packages/${item.slug}`},
    openGraph:{
      type:"website",
      locale:"en_US",
      siteName:"JimWas Repo",
      title:`${title} | JimWas Repo`,
      description,
      url:`/packages/${item.slug}`,
      images:image?[{url:image,width:1672,height:941,alt:`${item.name} product preview`}]:[],
    },
    twitter:{
      card:"summary_large_image",
      title:`${title} | JimWas Repo`,
      description,
      images:image?[image]:[],
    },
  };
}
export default async function PackagePage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const item=packages.find((value)=>value.slug===slug);
  if(!item)notFound();
  const checkoutEnabled=process.env.NEXT_PUBLIC_COMMERCE_ENABLED==="1";
  const related=packages
    .filter((value)=>value.slug!==item.slug)
    .sort((a,b)=>Number(b.slug.startsWith(item.slug)||item.slug.startsWith(b.slug))-Number(a.slug.startsWith(item.slug)||item.slug.startsWith(a.slug)));

  return <main className="detail">
    <Link href="/packages">← All packages</Link>
    <div className="detail-card">
      {item.banner&&<img className="detail-banner" src={item.banner} alt={`${item.name} product preview`}/>}
      <div className="detail-content">
        <div className="card-icon">{item.icon?.startsWith("/")?<img src={item.icon} alt=""/>:item.icon||"✦"}</div>
        <p className="eyebrow">{item.category}</p>
        <h1>{item.name}</h1>
        <p>{item.summary}</p>
        <div className="detail-price">{item.priceCents?`$${(item.priceCents/100).toFixed(2)} USD`:"Free"}</div>
        <p>{item.description}</p>
        <dl>
          <div><dt>Version</dt><dd>{item.version||"—"}</dd></div>
          <div><dt>Compatibility</dt><dd>{item.ios||"See release notes"}</dd></div>
          <div><dt>Architecture</dt><dd>{item.architecture||"—"}</dd></div>
        </dl>
        {item.priceCents===0&&item.filename
          ? <a className="primary purchase-button" href={`/${item.filename}`}>Download free trial</a>
          : checkoutEnabled
            ? <form action={`/buy/${item.packageId??item.slug}`} method="post"><button className="primary purchase-button" type="submit">Buy with Stripe — ${(item.priceCents/100).toFixed(2)}</button></form>
            : <div className="detail-notice">Stripe checkout is being set up. This package is not available to purchase or download here yet.</div>}
        {item.videoId&&<section className="detail-video" aria-label={`${item.name} video`}>
          <h2>Watch the demo</h2>
          <div className="detail-video-frame"><iframe src={`https://www.youtube-nocookie.com/embed/${item.videoId}`} title={`${item.name} video demo`} loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen/></div>
        </section>}
      </div>
    </div>
    {related.length>0&&<section className="similar-products" aria-labelledby="similar-products-title">
      <p className="eyebrow">KEEP EXPLORING</p>
      <h2 id="similar-products-title">Similar Products</h2>
      <div className="cards">{related.map((product)=><Link href={`/packages/${product.slug}`} className="card" key={product.slug}>
        <div className="card-icon">{product.icon?.startsWith("/")?<img src={product.icon} alt=""/>:product.icon||"✦"}</div>
        <div className="card-meta">{product.category}<b>{product.priceCents?`$${(product.priceCents/100).toFixed(2)}`:"Free"}</b></div>
        <h3>{product.name}</h3>
        <p>{product.summary}</p>
        <span>View package →</span>
      </Link>)}</div>
    </section>}
  </main>;
}
