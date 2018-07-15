let nMatches = 30

const dotProduct = (() => {
    // Thanks to https://gist.github.com/TooTallNate/4750953
    const isLittleEndian = new Uint8Array(new Uint32Array([0x12345678]).buffer)[0] === 0x78
    if (isLittleEndian) return function dotProduct(view1, index1, view2, index2) {
        let dot = 0
        for (let i = 0; i < 300; i++) { // Each word vector is length 300
            dot += view1[index1 * 300 + i]
                    * view2[index2 * 300 + i]
        }
        return dot
    }
    return function dotProduct(view1, index1, view2, index2) {
        const dv1 = new DataView(view1.buffer, view1.byteOffset)
        const dv2 = new DataView(view2.buffer, view2.byteOffset)
        // console.log(dv1.getFloat32(index1 * 300 * 4, true))
        let dot = 0
        for (let i = 0; i < 300; i++) { // Each word vector is length 300
            dot += dv1.getFloat32(index1 * 300 * 4 + i * 4, true)
                    * dv2.getFloat32(index2 * 300 * 4 + i * 4, true)
        }
        return dot
    }
})()

function parseNpy(buffer) {
    const magicData = new Uint8Array(buffer, 0, 6)
    let magic = ''
    magicData.forEach(c => magic += String.fromCharCode(c))
    if (magic !== '\x93NUMPY') throw new Error('Invalid magic string')

    const [major, minor] = new Uint8Array(buffer, 6, 2)
    if (major != 1 || minor != 0) throw new Error('Only version 1.0 supported')

    const headerLength = new DataView(buffer).getUint16(8, true)
    return new Float32Array(buffer, 10 + headerLength)
}

(async () => {
    const cache = {}
    const mapping = await (await fetch('data/mapping.json')).json()
    const nameMap = await (await fetch('data/namemap.json')).json()
    const emojiVocab = (await (await fetch('data/emoji.txt')).text()).split(' ')
    const emojiWeights = parseNpy(await (await fetch('data/emoji.npy')).arrayBuffer())
    const threeFiles = await (await fetch('data/threefiles.json')).json()
    const fsForbid = '<>:"/\\|?*'
    let currentSearch = null

    async function search(term) {
        const ret = {
            vocablen: 0,
            meddot: 0,
            emoji: [],
            g30: 0
        }

        term = term.replace(/ /g, '_')
        currentSearch = term
        if (term.length == 0) return ret //  nothing as input isn't valid

        const modTerm = term.replace(/./g, (c) => {
            if (fsForbid.includes(c)) return String.fromCharCode(c.charCodeAt(0) + 128)
            return c
        }).toLowerCase()

        const fl = modTerm[0]
        const sl = modTerm[1] || ' '
        const tl = modTerm[2] || ' '

        let filename = threeFiles.includes(fl+sl) ? fl+sl+tl : fl+sl

        const { vocab, weights } = await (async () => {
            if (cache[filename]) return cache[filename]
            const vocab = (await (await fetch(`data/dat-${filename}.txt`)).text()).split(' ')
            const weights = parseNpy(await (await fetch(`data/dat-${filename}.npy`)).arrayBuffer())
            return cache[filename] = { vocab, weights }
        })()

        ret.vocablen = vocab.length
        if (currentSearch != term) return ret

        let index = vocab.indexOf(term) // Find index by case
        if (index == -1) {
            const lowercaseTerm = term.toLowerCase() // Find index without considering case
            index = vocab.findIndex(v => v.toLowerCase() == lowercaseTerm)
        }
        if (index == -1) return ret

        const start = performance.now()
        const results = []

        // Compute the dot products, also keeping track of the index they correspond
        // to in the vocab array
        const products = emojiVocab.map((_, emojiIndex) => {
            return [emojiIndex, dotProduct(weights, index, emojiWeights, emojiIndex)]
        })
        // Sort the products descending by their value (index 1 of the inner arrays)
        products.sort((a, b) => a[1] - b[1])
        products.reverse()
        ret.meddot = products[Math.floor(products.length / 2)][1]
        ret.g30 = products.filter(p => p[1] > 0.3).length // Binary search would be faster but more code

        const emoji = []
        for (let i = 0; i < products.length && emoji.length < nMatches; i++) {
            const [index, dotprod] = products[i]
            if (!mapping[emojiVocab[index]]) continue
            for (let emote of mapping[emojiVocab[index]]) {
                if (emoji.length < nMatches && !emoji.includes(emote)) {
                    emoji.push(emote)
                    results.push({
                        emote,
                        word: emojiVocab[index],
                        dotprod
                    })
                }
            }
        }
        ret.emoji = results
        return ret
    }

    function updateEmoji({emoji, vocablen, meddot, g30}) {
        results.innerHTML = emoji.map((res) => {
            return emojiElem(res.emote, nameMap[res.emote], res.word, res.dotprod)
        }).join('')
        vocablenEl.innerHTML = vocablen
        meddotEl.innerHTML = meddot.toFixed(2)
        g30El.innerHTML = g30
        matchesEl.innerHTML = emoji.length
    }

    const inp = document.querySelector('input')
    const results = document.querySelector('#results')
    const vocablenEl = document.querySelector('#stat-vocablen')
    const meddotEl = document.querySelector('#stat-meddot')
    const g30El = document.querySelector('#stat-g30')
    const matchesEl = document.querySelector('#stat-matches')
    inp.addEventListener('input', (ev) => {
        results.classList.toggle('blank', inp.value.length == 0);
        search(inp.value).then(updateEmoji).catch((err) => console.error(err))
    })
    search('hello').then(updateEmoji)
})()

function emojiElem(emote, name, path, dotprod) {
    const cls = dotprod < 0.3 ? 'terrible' : dotprod < 0.45 ? 'bad' : dotprod > 0.9 ? 'good' : ''
    return `<div class="result ${cls}">
        ${emojiImg(emote, 24)}
        <span class="emoji-name">${name.replace(/_/g, '<span class="underscore">_</span>')}</span>
        <span class="emoji-path">${path.toLowerCase().replace(/_/g, ' ')}</span>
        <span class="emoji-acc">${(dotprod*100).toFixed(0)}%</span>
    </div>`
}

function emojiImg(str, size) {
    return twemoji.parse(str).replace('alt', `width="${size}px" height="${size}px" alt`)
}
