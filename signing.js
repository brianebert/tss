import {default as wallet} from "@stellar/freighter-api";
import {Keypair, StrKey} from "stellar-base";
import {AccountWatcher, AccountDigger} from './apiReaders.js';
import {StellarAccount} from './stellar.js';
import {COL_Node} from './cols.js';
import {request} from './http.js';
import * as Sodium from './na.js';

const HORIZON = 'https://horizon.stellar.org';


export class SigningAccount extends StellarAccount {
  #ec25519; // hex string for asymetric encryption
  #ed25519; // a Stellar Keypair for automated signing
  #shareKX; // hex string key pair for key shared key exchange
  constructor(address, keys=null){
    if(!StrKey.isValidEd25519PublicKey(address))
      throw new Error(`SigningAccount requires valid Ed25519 Public Key as arguement.`)
    super(address, keys);
    this.#ec25519 = keys?.ec25519 ? keys.ec25519 : null;
    this.#ed25519 = keys?.ed25519 ? keys.ed25519 : null;
    this.#shareKX = keys?.shareKX ? keys.shareKX : null;
  }

  get ec25519(){
    return this.#ec25519
  }

  get ed25519(){
    return this.#ed25519
  }

  get shareKX(){
    return this.#shareKX
  }

  static async fromWallet(){
    console.log(`working with wallet: `, wallet);
    console.log(`in a browser: `, wallet.isBrowser);
    if(wallet.isBrowser && await wallet.isConnected())
      return wallet.getPublicKey().then(address => new this(address))
    return Promise.resolve(null)
  }

  async deriveKeys(secret=null){
    if(secret){
      var kp = Keypair.fromSecret(secret);
      if(kp.publicKey() !== this.account.id)
        throw new Error(`if deriveKeys is passed secret, it must match account.id`);
    }

    // this gets called at the end
    function theThen(signedXdr){
      const sig = SigningAccount.sigFromXDR(signedXdr);
      return Sodium.keysFromSig(sig)
        .then(keys => {
          //console.log(`derived keys: `, keys);
          this.#ec25519 = keys.ec25519;
          this.#shareKX = keys.shareKX;
          // ed25519 seed needs to be extracted for Stellar Keypair
          this.#ed25519 = {sk: keys.ed25519.sk.slice(0, 32),
                           pk: keys.ed25519.pk};
          return keys
        })
        .catch(err => {
          console.error(`Error deriving app's encryption keys: `, err);
        })
    }

    // StellarAccount.signingPhrase returns a Stellar transaction, once necessary for Freighter
    // to sign, with the SigningAccount's id embedded in the transaction's memo. The latter should
    // be looked at for security problems. Freighter has since started signing blobs and thus this
    // key derivation can become more flexible
    const myPhrase = StellarAccount.signingPhrase(this.account.id);

    if(secret){
      myPhrase.sign(kp);
      return Promise.resolve(myPhrase.toXDR())
        .then(theThen.bind(this)).then((keys) => {
          //console.log(`got keys: `, keys);
          //console.log(`and keypair: `, kp);
            this.#ed25519 = {
            sk: kp.rawSecretKey(),
            pk: kp.rawPublicKey()
          };
        })
    }

    if(await wallet.getPublicKey() === this.account.id)
      return wallet.signTransaction(myPhrase.toXDR()).then(theThen.bind(this))
    else
      throw new Error(`Freighter account does not match Signing Account`)
  }

  async sharedKeys(account, label){
    //console.log(`deriving shared keys with ${account}.data[${label}]`);
    if(typeof account === 'string' && StrKey.isValidEd25519PublicKey(account))
      return await request(`${HORIZON}/accounts/${account}`).then(response => {
        //console.log(`account response is `, JSON.parse(response));
        let buf = Buffer.from(JSON.parse(response).data[label], 'base64');
        //console.log(`created buf: `, buf);
        return buf
      })//.then(pk => Sodium.sharedKeys(this.#shareKX, pk))
      .then(pk => Promise.all([
         Sodium.sharedKeyRx(this.#shareKX, pk),
         Sodium.sharedKeyTx(this.#shareKX, pk)
      ]))
      .then(([receiver, sender]) => ({rx: receiver, tx: sender}))
  }
}