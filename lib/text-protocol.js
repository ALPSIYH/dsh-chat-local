// One protocol for browser feedback and server routing. Keep this factory self-contained.
export function createTextProtocol() {
  const extensions = "docx|md|markdown|mdx|txt|json|jsonl|yaml|yml|toml|csv|tsv|js|jsx|mjs|cjs|ts|tsx|py|r|do|rb|rs|go|java|kt|swift|sh|zsh|fish|sql|html|css|scss|xml|tex|bib|log";
  function fileReferences(text) {
    const found = new Set();
    let rest = String(text ?? "");
    const add = value => { const path=value.trim(); if(path && !/^[a-z][a-z\d+.-]*:/iu.test(path)) found.add(path); };
    for (const pattern of ["\\]\\(<([^>\\n]+?\\.(?:"+extensions+"))>\\)", "`([^`\\n]+?\\.(?:"+extensions+"))`", "\\]\\(([^)\\n]+?\\.(?:"+extensions+"))\\)"]) {
      rest=rest.replace(new RegExp(pattern,"giu"),(_match,path)=>{add(path);return " ";});
    }
    rest=rest.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>`]+/giu," ");
    // Natural language frequently contains macOS paths with spaces and no Markdown wrapper.
    rest=rest.replace(new RegExp("/(?:Users|Volumes|private|tmp|home|mnt|workspace)/[^\\n<>`，。；;]*?\\.(?:"+extensions+")(?=$|[\\s，。；;）)\\]])","giu"),(path)=>{add(path);return " ";});
    for (const match of rest.matchAll(new RegExp("(?:^|[\\s（(：:])(/(?!/)[^\\s<>`，。；;]+?\\.(?:"+extensions+"))(?=$|[\\s，。；;）)\\]])","giu"))) add(match[1]);
    return [...found];
  }
  function mentions(text, members) {
    const visible=String(text??"").replace(/```[^]*?(?:```|$)|~~~[^]*?(?:~~~|$)|`[^`\n]*`|https?:\/\/\S+/gu," ");
    const ordered=[...members].filter(m=>m.alias).sort((a,b)=>b.alias.length-a.alias.length);
    const result=new Set();
    for(let index=visible.indexOf("@");index>=0;index=visible.indexOf("@",index+1)) {
      if(index>0 && /[a-z\d_]/iu.test(visible[index-1])) continue;
      const tail=visible.slice(index+1);
      const all=tail.match(/^(all|全部)(?![a-z\d_-])/iu);
      if(all){result.add("all");continue;}
      for(const member of ordered) {
        if(tail.slice(0,member.alias.length).toLocaleLowerCase()!==member.alias.toLocaleLowerCase())continue;
        const next=tail[member.alias.length]??"";
        if(/^[\x00-\x7F]+$/u.test(member.alias)&&/[\p{L}\p{N}_-]/u.test(next))continue;
        result.add(`session:${encodeURIComponent(member.sessionId)}`);break;
      }
    }
    return [...result];
  }
  return { fileReferences, mentions };
}
export const textProtocol = createTextProtocol();
