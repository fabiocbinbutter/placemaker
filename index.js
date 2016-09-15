//#! /usr/bin/env node

const Promise=require('bluebird');
const promisify = require("promisify-node");
const fs=require('fs');
const pfs=promisify(fs,undefined,true);
const util=require('util');
require('console.table')
const sharp=require('sharp');
//const request=require('request');
//const pRequest=promisify(require('request'));
const pRequest=require('request-promise');


var doT=require('dot');
doT.templateSettings.strip=false;
var templates = doT.process({ path: __dirname});
//const uncss=require("uncss");
//const compressor = require('node-minify');
const validate = require('jsonschema').validate;
try{
		const jsonSchema=JSON.parse(fs.readFileSync("./ui/buildJson.schema.json"));
	}catch(e){throw "Invalid buildJson\n"+e;}
const constants= new Constants();
const counter=function* (){for(var i=0;;i++)yield i;}();

const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

app.post("/build",function(req, res){
		try{
				var post=req.body;
				var valid=validate(post,jsonSchema);
				if(valid.errors && valid.errors.length){throw valid.errors}
			}catch(e){
				res.status(400).send(e);
			}
		var noImg=post.skipImages;
		var time=timer(peek("Request "+counter.next().value+": "+post.slug+(noImg?" [noImg]":"")));
		if(post.rebuildTemplate){
			templates = doT.process({ path: __dirname});
			time("Template rebuilt")()
		}
		const baseDir="places/"+post.slug+"/"
		const imgDir=baseDir+"img/";
		var pDir=Promise.resolve().then(time("Init Promises"))
				.then(()=>pfs.mkdir("places")).catch((x)=>"Exists")
				.then(()=>pfs.mkdir(baseDir.slice(0,-1))).catch((x)=>"Exists")
				.then(()=>pfs.mkdir(imgDir.slice(0,-1))).catch((x)=>"Exists")


		var pFoursquareData=
				Promise.resolve(pDir) //To get blue bird's fancier promises, with map et al.
				.then(()=>constants.foursquareSections)
				.map(urlFromLlSection(post.ll))
				.then(time("Begin foursquare requests"))
				.map(pRequest)
				.then(time("End foursquare requests"))
				.map(arity1(JSON.parse))
				.map(pluck('response'))
				.map(set("section",(r,i)=>constants.foursquareSections[i].label))

		var pVenues=pFoursquareData
				.map(venuesFromResponse)//pluck("groups")).reduce(flatten,[]).map(pluck("items")).reduce(flatten,[]).map(pluck("venue"))
				.reduce(flatten,[])

		var pImages=pVenues
				.map(imageFromVenue)//(pluck(".photos.groups.0.items.0."))
				.filter(pluck('id'))
				.map(set("url",img=>img.prefix+"300x300"+img.suffix))
				.map(set("localUrl",img=>"/"+imgDir+img.id+extractExtension(img.suffix)))
				.then(time((noImg?"Skipping":"Begin fetching")+" tile images"))
				.map(img=>noImg||
						pRequest({url:img.url, encoding:'binary'})
						.then(body=>pfs.writeFile(img.localUrl.slice(1),body,'binary'))
					,{concurrency:1})
				.then(time((noImg?"Skipped":"Done fetching")+" tile images"))
				//.then(arr=>peek(post.slug+": "+arr.length+" image files written"))
			;

		var pCoverImg=noImg||
				pRequest({url:post.coverUrl, encoding:'binary'})
				.then(sharp().resize(640,480).crop(sharp.strategy.entropy))
				.then(body=>
						pfs.writeFile(imgDir+"cover"+extractExtension(post.coverUrl),body,'binary')
					)
			;
		var pDetailsTemplate=
				pfs.readFile('ui/details.dot')

		Promise
				.all([pFoursquareData,pVenues,pImages,pCoverImg,pDetailsTemplate])
				.then(time("All prequisites ready, writing index.html"))
				.then(all=>
						pfs.writeFile(
								baseDir+"index.html",
								templates.auto({
										post:post,
										foursquare:all[0],
										embed:{
												"#fs":all[1].map(compactVenue).reduce(indexBy("id"),{})
											},
										detailsTemplate:all[4]
									})
							)
							.then(()=>pfs.writeFile(baseDir+"spec.json",JSON.stringify(post,undefined,2)))
							.then(()=>pfs.writeFile(baseDir+"fs.json",JSON.stringify(all[0],undefined,2)))
					)
				.then(time("Done writing HTML & JSON"))
				.then(()=>
						res.status(200).send("Place '"+post.slug+"' built!")
					)
				.catch((e)=>
						res.status(500).send(JSON.stringify(e,undefined,2))
					)
				.then(time("Response sent!"))
				.then(time(table))
				//.then(time(peek))
			;
	});
app.use(express.static('ui'))
app.listen(8009,()=>peek("Listening on 8009"))

//Arr, here there be functions!

function Constants(){
		this.sizes={
				tile:[{w:160,h:160},{w:240,h:240},{w:320,h:320}],
				cover:[{w:640,h:480},{w:640*1.5,h:480*1.5},{w:640*2,h:480*2}],
				"default":[{w:320,h:320},{w:640,h:640}]
			};
		this.imgExts={
				"image/jpeg":".jpg",
				"image/png":".png",
				"image/tiff":".tiff",
				"image/webp":".webp",
			};
		this.foursquareClientId="ZKOLUXH5J10MQ3QSHGKPSC1BJLEZ5SEZ4SW2QMAKKOHA1VHD";
		this.foursquareClientSecret="W4IF24QI1B2IIUMLTOJCGJJO3FEQSZINFSKCIMMKXPFQO3HQ";
		this.foursquareQuerystring="?v=20160601&client_id="+this.foursquareClientId+"&client_secret="+this.foursquareClientSecret;
		this.foursquareSections=[
				{name:"shops",radius:250,label:"Shops"},
				{name:"food",radius:250,label:"Food"},
				//{name:"sights",radius:500,label:"Sights"},
				{name:"arts",radius:500,label:"Arts"},
				{name:"outdoors",radius:500,label:"Outdoors"}
			]
		//included in ui/details.dot instead... this.googleMapsEmbedKey='AIzaSyAcuBsf9hDHAcRHx-bMaZoDLtYPvfP95Nk'
	}

function urlFromLlSection(ll){
		return function llUrlFromSection(s){
				return ("https://api.foursquare.com/v2/venues/explore/"
						+constants.foursquareQuerystring
						+"&ll="+ll
						+"&section="+s.name
						+"&radius="+s.radius
						+"&limit=6&time=any&day=any&venuePhotos=1"
					);
			};
	}

function jsonExtract(property){
		return function(json){
				var ret=[];
				try{
				JSON.parse(json,function(k,v){
						if(k==property){
								ret.push(v)
							}
						return v;
					});
				}catch(e){
					throw({exception: e, json:json});
				}
				return ret;
			}
	}

function imageFromVenue(venue){
		if(venue && venue.photos && venue.photos.count){
				return venue.photos.groups[0].items[0];
			}else if(venue && venue.categories && venue.categories[0]){
				return venue.categories[0].icon;
		}else{
				return {}
			}
	}
function venuesFromResponse(response){
	return (response.groups
			.map(pluck("items"))
			.reduce(flatten,[])
			.map(pluck("venue"))
		);
	}
function compactVenue(venue){
		const img=imageFromVenue(venue)
		return {
				id:venue.id,
				name:venue.name||"",
				ll:(venue.location&&venue.location.lat+","+venue.location.lng)||"",
				img:img.prefix+"600x300"+img.suffix,
				tel:(venue.contact&&venue.contact.formattedPhone)||"",
				add:(venue.location&&venue.location.formattedAddress)||"",
				url:(venue.menu && venue.menu.mobileUrl)||venue.url||"",
				$:(venue.price&&venue.price.tier)||"",
				rtg:venue.rating||"",
				rco:venue.ratingColor||""
			};
	}

function extractExtension(path){
		var a=(path||"").split("?")[0].split("#")[0].split('.');
		return ((a.length==1)?"":"."+a.slice(-1)[0])
		//return path.match(/(\.[^.]{1,12})[$?#]/)
	}

function peek(o){
			console.log(
					util.inspect(o,{colors:true, depth:1, maxArrayLength:5})
					.replace(/"([^"]{40})([^"]|\")+"/,'"$1"')
					.replace(/(\n\s+([_a-zA-Z$][_0-9a-zA-Z$]*)?:)\s+([_a-zA-Z$][_0-9a-zA-Z$]* {)/g,"$1 $2")
				);
			return o;
		}
function table(o){
		console.table(o);
		return o;
	}

function pluck(path){
		const keys=path.split('.').map(k=>k.match(/\d{1,4}/)?parseInt(k):k);
		const l=keys.length-1;
		return function(o){
				for(var i=0;o=o[keys[i]];i++){
						if(i==l){return o;}
					}
			}
	}
function flatten(a,b){return a.concat(b);}
function arity1(fn){
		return function(a){return fn(a);}
	}
function set(prop,fn){
		return function(obj,i){
				obj[prop]=fn(obj,i)
				return obj;
			}
	}

function indexBy(by){
		return function (accum,x,i){
				var key=(typeof by=="function"?by(x):x[by])
				accum[key]=x;
				return accum;
			}
	}

function timer(name){
		var seq=[{evt:name,time:process.hrtime()}];
		return function(evt){
				return function(passthru){
						if(typeof evt=="string"){
								seq.push({evt:evt,time:process.hrtime(seq[0].time)})
							}
						if(typeof evt=="function"){
								evt(seq);
							}
						return passthru;
					}
			}
	}
