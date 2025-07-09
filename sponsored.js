import {Operation} from '@stellar/stellar-base';
import {StellarAccount} from './signing.js';

class SponsoredAccount extends StellarAccount{
    #ready; #account;
    constructor(sponsor, kp){
        if(!sponsor.canSign)
          throw new Error(`SponsoredAccount requires valid signing account as arguement.`)
        super(kp.publicKey());
        this.#ready = sponsor.tx(
            [
                Operation.beginSponsoringFutureReserves({
                    sponsoredId: this.id
                }),
                Operation.createAccount({
                    destination: this.id,
                    startingBalance: '0'
                }),
                Operation.manageData({
                    name: 'index',
                    value: '0',
                    source: this.id
                }),
                Operation.manageData({
                    name: 'address',
                    value: 'bafybeigdyrzt5s27qndey5kht3i7q667w7nzffoax6yggs3z3xzzhmdrzi',
                    source: this.id
                }),
                Operation.setOptions({
                    signer: {
                        ed25519PublicKey: sponsor.id,
                        weight: 255
                    },
                    source: this.id
                }),
                Operation.endSponsoringFutureReserves({
                    source: this.id
                })
            ],
            false,
            [kp]
        )
        .then(async () => this.#account = await StellarAccount.load(kp.publicKey()));
    }

    // All getters return promises
    get ready(){
        return this.#ready;
    }

    // All getters return promises
    get address(){
        return this.#ready.then(account => 
            Buffer.from(account.data.address, 'base64')
                  .toString('ascii')
        )
    }

    // All getters return promises
    get index(){
        return this.#ready.then(account => 
            Buffer.from(account.data.index, 'base64')
                  .toString('ascii')
        )
    }

    static async merge(sponsor, id){
        const sponsee = await StellarAccount.load(id);
        if(Array.from(sponsee.signers).filter(signer => signer.key === sponsor.id).length !== 1)
            throw new Error(`Sponsored account ${id} is not sponsored by ${sponsor.id}`);

        return sponsor.tx(
            [
                Operation.manageData({
                    name: 'index',
                    value: null,
                    source: id
                }),
                Operation.manageData({
                    name: 'address',
                    value: null,
                    source: id
                }),
                Operation.accountMerge({
                    destination: sponsor.id,
                    source: id
                })
            ]
        )
        .then(() => console.log(`merged sponsored account: ${id} into sponsor: ${sponsor.id}`));
    }
}

/* Below was used to test class
import {SigningAccount} from './signing.js';
import {Keypair} from '@stellar/stellar-base';
const sponsor_keys = Keypair.fromSecret('SAEIC2BBP7OPQ22O42COL73VOFEYI2AR42UI6BGR3EK7IAQOH3XZN5O6');
const sponsored_keys = Keypair.random();
const sponsor = new SigningAccount(sponsor_keys.publicKey(), sponsor_keys.secret());
let sponsored;
sponsor.ready
.then(() => sponsored = new SponsoredAccount(sponsor, sponsored_keys))
.then(async sponsored => await sponsored.ready)
.then(async () => console.log(`sponsored account index: `, await sponsored.index))
.then(() => SponsoredAccount.merge(sponsor, sponsored.id))
.catch(err => console.error(`error: `, err));*/