import {SigningAccount} from './signing.js';
import {COL_Node} from './cols.js';

// combines SigningAccount keys with COL_Node
class Encrypted_Node extends COL_Node {
  #dataRootLabel; #signingAccount;
  constructor(value, signingAccount, dataRootLabel=''){
    if(!signingAccount instanceof SigningAccount)
      throw new Error(`called Encrypted_Node constructor with signingAccount = `, signingAccount)
    super(value);
    this.#signingAccount = signingAccount;
    this.#dataRootLabel = dataRootLabel;
  }

  get signingAccount(){
    return this.#signingAccount
  }

  set dataRootLabel(label){ // setting dataRootLabel will write a node's hash to Stellar
    return this.#dataRootLabel = typeof label === 'string' ? label : ''
  }

  static SigningAccount = SigningAccount;

  static async fromCID(account, cid, keys=null){
    if(!account instanceof SigningAccount)
      throw new Error(`Must call Encrypted_Node.fromCID with a SigningAccount`)
    return this.read(cid, keys).then(async instance => {
        instance.#signingAccount = account;
        await instance.ready;
        return instance
      })
  }

  static async fromSigningAccount(account, dataRootLabel, keys=null){
    const root = await SigningAccount.dataEntry(account, dataRootLabel);
    console.log(`looked up data root: ${root.toString()}`)
    if(root.length === 0){
      var node = new this({colName: dataRootLabel}, account, dataRootLabel);
      await node.ready;
    }
    else {
      var node = await this.fromCID(account, root.toString(), keys);
      node.#dataRootLabel = dataRootLabel;
    }
    return node
  }

  static async copy(opts){
    const {signingAccount, address, inKeys, outKeys, traverse, dataRootLabel} = opts;
    const root = await this.fromCID(signingAccount, address, inKeys);
    const copyRoot = await root.copy(inKeys, outKeys, traverse);
    console.log(`have copied, starting from root: `, copyRoot);
    if(dataRootLabel.length){
      signingAccount.setDataEntry(dataRootLabel, copyRoot.cid.toString());
    }
    return root;
  }

  async copy(inKeys=null, outKeys=null, traverse=false){
console.log(`entered instance.copy with `, this, inKeys, outKeys);
    const graphNodes = []; // (hopefully) will use later cleaning cache and local storage
    const needsReLinking = !!inKeys !== !!outKeys || !!inKeys && !!outKeys && 
                           JSON.stringify(inKeys.reader) !== JSON.stringify(outKeys.writer);
    async function writeNode(node){
      const keys = needsReLinking ? outKeys : null;
      await node.write('', keys, false, false);
      graphNodes.push(node);
    }
    const linkMap = {};
    async function reWriteNode(node){
      const value = Object.assign({}, node.value);
      const links = Object.entries(node.links);
      if(links.length > 1)
        for(const [name, cid] of links)
          if(!name.endsWith('_last'))
            value[name] = linkMap[cid.toString()].cid;
      console.log(`graphNodes and linkMap are: `, graphNodes, linkMap);
      const ptNode = await new Encrypted_Node(value, node.signingAccount).write('', outKeys, false, false);
      linkMap[node.cid.toString()] = ptNode;
      graphNodes.push(ptNode);
      console.log(`graphNodes and linkMap are: `, graphNodes, linkMap);
    }
    if(traverse)
      if(needsReLinking)
        await Encrypted_Node.traverse(this.cid, reWriteNode, inKeys);
      else
        await Encrypted_Node.traverse(this.cid, writeNode, inKeys);
    else
      await writeNode(this);
    return graphNodes.pop();
  }
}

export {Encrypted_Node};