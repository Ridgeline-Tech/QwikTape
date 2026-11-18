"use strict";
import { default as chevrotain } from "./vendor/chevrotain.min.js";
import { BigNum, BigNumEnv } from "./bignum.js";

// ----------------- lexer -----------------
let activeExtension = null
let extensionMatcherDiagnostics = []
let reportedMatcherFailures = new Set()

function recordMatcherFailure(kind, error, offset) {
  if(reportedMatcherFailures.has(kind)) return
  reportedMatcherFailures.add(kind)
  extensionMatcherDiagnostics.push({
    kind: 'extension',
    name: 'ExtensionMatcherError',
    message: `${kind} failed: ${String(error)}`,
    offset,
  })
}

function extensionMatch(kind, text, offset) {
  let matcher
  try {
    matcher = activeExtension?.[kind]
  }
  catch(error) {
    recordMatcherFailure(kind, error, offset)
    return null
  }
  if (typeof matcher !== "function") return null

  let descriptor
  try {
    descriptor = matcher(text, offset)
    if (descriptor === null || descriptor === undefined) return null
    if (!Number.isInteger(descriptor.length) || descriptor.length <= 0 ||
        offset + descriptor.length > text.length || !("value" in descriptor)) {
      throw new TypeError(`${kind} returned an invalid descriptor`)
    }
    if (descriptor.formatting !== undefined && typeof descriptor.formatting !== "string") {
      throw new TypeError(`${kind} formatting must be a string`)
    }
  }
  catch(error) {
    recordMatcherFailure(kind, error, offset)
    return null
  }

  const match = [text.slice(offset, offset + descriptor.length)]
  match.index = offset
  match.input = text
  match.payload = {
    extension: true,
    value: descriptor.value,
    formatting: descriptor.formatting,
  }
  return match
}

const CstParser = chevrotain.CstParser;
const createToken = chevrotain.createToken;
const Lexer = chevrotain.Lexer;
const EmbeddedActionsParser = chevrotain.EmbeddedActionsParser;
const BaseParser = EmbeddedActionsParser;
//const BaseParser = CstParser;
const tokenMatcher = chevrotain.tokenMatcher;

const chars = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const Operator = createToken({name: "Operator", pattern: Lexer.NA});
const EOF = chevrotain.EOF;
const Sums = createToken({name: "Sums", pattern: Lexer.NA});
const Plus = createToken({ name: "Plus", pattern: /\+/, categories: [Sums, Operator] });
const Products = createToken({name: "Products", pattern: Lexer.NA});
const Mult = createToken({ name: "Mult", pattern: /[\*×]/, categories: [Products, Operator] });
const Div = createToken({ name: "Div", pattern: /[\/÷]/, categories: [Products, Operator] });
const NewLine = createToken({ name: "NewLine",  pattern: /\r?\n/});
const LParen = createToken({ name: "LParen", pattern: /\(/ });
const RParen = createToken({ name: "RParen", pattern: /\)/ });
const Pow = createToken({ name: "Power", pattern: /\^/, categories: [Operator] });
const ExtensionPrefix = createToken({
  name: "ExtensionPrefix",
  pattern: (text, offset) => extensionMatch("matchPrefix", text, offset),
  line_breaks: false,
})
const ExtensionLiteral = createToken({
  name: "ExtensionLiteral",
  pattern: (text, offset) => extensionMatch("matchLiteral", text, offset),
  line_breaks: false,
})
const ExtensionPostfix = createToken({
  name: "ExtensionPostfix",
  pattern: (text, offset) => extensionMatch("matchPostfix", text, offset),
  line_breaks: false,
})

//not using ; in the parser code below to reduce noise

const Minus = createToken({
  name: "Minus", 
  pattern: /(?<!([-\+\*×\/÷][ \t]*)|═(\r?\n[ \t]*))-/,
  categories: [Sums, Operator],
  start_chars_hint: ['-'],
  line_breaks: false,  
})

const Seperator = createToken({
  name: "Seperator",
  pattern: /═+/,
})

const NumberLiteral = createToken({
  name: "NumberLiteral",
  pattern: matchNumberLiteral,
  line_breaks: false,
  start_chars_hint: [..."-0123456789."],
})

//parse number and calculate its decimal places and formatting
//let regexpNumberLiteral = /-?\d+(\.\d*)?|-?(\.\d+)/y
let regexpNumberLiteral = BigNumEnv.getNumeralMatcher()
function matchNumberLiteral(text, offset, lexedTokens){
  let lastToken = lexedTokens[lexedTokens.length-1]
  if(lastToken && tokenMatcher(lastToken, NumberLiteral)) {
    return null
  }
  regexpNumberLiteral.lastIndex = offset
  const match = regexpNumberLiteral.exec(text)
  
  if(!match) return null
  
  try {
    const value = BigNum.parseString(match[0])
    const mantissa = match[1] ?? match[2] ?? "0"
    match.payload = {
      parse: value,
      formatted: match[1] ? true : false,
      decimalDigits: mantissa.length-1,
      decimalPosition: match[0].length - (match[2] ? 1 : (match[1]?.length ?? 0)),
    }
  }
  catch(e){
    return null
  }
  return match
}

const Percentage = createToken({ 
  name: "Percentage",
  pattern: matchPercentage,
  line_breaks: false,
  start_chars_hint: ["%"],
})

const regexpPercentage = /(?<=\w)%(?:[ \t]*[⥱├\|][ \t]*(-?\d+(?:\.\d*)?))?/y
function matchPercentage(text, offset){
  regexpPercentage.lastIndex = offset
  const match = regexpPercentage.exec(text)
  if(match) match.payload = {seperator: ' ⥱ ', value: match[1] ?? null}
  return match
}

//not used
const Infinite = createToken({
  name: "Infinite",
  pattern: /Infinity/,
})

const Annotation = createToken({
  name: "Annotation",
  pattern: /(?<=[\w\d]+%?[ \t]*).+(?<!( |[^\d])+[\/\÷\+\-\*\×])/,
  line_breaks: false,
  start_chars_hint: [...chars,..."123456790."],
})
  
const Text = createToken({
  name: "Text",
  pattern: /.+/,
  //pattern: matchText,
})

const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /[ \t]+/,
  group: Lexer.SKIPPED,
})

const Variable = createToken({
  name: "Variable",
  pattern: /[a-zA-Z]\w*(?=[ \t]*\=)/,
})

const Identifier = createToken({
  name: "Identifier",
  pattern: /(?<=[=\(\-\+\*×\/÷\^][ \t]*)[a-zA-Z]\w*/,
  start_chars_hint: chars,
  line_breaks: false,
})

//todo: benchmark if creating new regex is faster than iterate all tokens for a variable 
const regexpDefinedIdentifier = /(?<=\r?\n *)[a-zA-Z]\w*(?=.*(\r?\n)?[-\+\*×\/÷\^])/y
function matchDefinedIdentifier(text, offset, lexedTokens){
  regexpDefinedIdentifier.lastIndex = offset
  const match = regexpDefinedIdentifier.exec(text)
  if(!match) return match
  const definedVariable = new RegExp(`^[ \\t]*${match[0]}[ \\t]*=|^[ \\t]*${regexpNumberLiteral.source}[ \\t]*=[ \\t]*${match[0]}\\s`, "gm")
  const variable = definedVariable.test(text.substring(0, offset))
  if(!variable) return null
  return match
}

const DefinedIdentifier = createToken({
  name: "Identifier",
  pattern: matchDefinedIdentifier,
  start_chars_hint: chars,
  line_breaks: false,
})

const Equal = createToken({
  name: "Equal",
  pattern: /(?<=[a-zA-Z]\w*[ \t]*)=/,
  line_breaks: false,
  start_chars_hint: ['='],
})

//an equal present after result seperator
const ResultEqual = createToken({
  name: "Equal",
  pattern: /(?<=═\s?\n.*)=/,
  line_breaks: false,
  start_chars_hint: ['='],
})

const SuffixIdentifier = createToken({
  name: "SuffixIdentifier",
  pattern: /(?<=═\s?\n.*=[ \t]*)[a-zA-Z]\w*/,
  start_chars_hint: chars,
  line_breaks: false,
})

const TokenType = {NewLine: NewLine, Block: 1, Insert: 2, Tooltip: 3, Annotation: Annotation};

Equal.LABEL = "=";
ResultEqual.LABEL = "=";
Operator.LABEL = "+|-|*|×|/|÷|^";
Sums.LABEL = "+|-";
Products.LABEL = "*|×|/|÷";
NewLine.LABEL = "↵";
LParen.LABEL = "(";
RParen.LABEL = ")";
Pow.LABEL = "^";
Minus.LABEL = "-";
Percentage.LABEL = "'%' ⥱ value?";
DefinedIdentifier.LABEL = "Defined Identifier";

const nativeTokens = [
  WhiteSpace, Seperator, NewLine,
  SuffixIdentifier,
  LParen,RParen,
  Plus, Minus,
  Mult, Div,  Pow,
  ResultEqual, Equal,
  Percentage,
  Annotation,
  NumberLiteral,
  Variable, Identifier, DefinedIdentifier,
  Text,
  Operator,
]

const extensionTokens = [
  WhiteSpace, Seperator, NewLine,
  SuffixIdentifier,
  LParen,RParen,
  ExtensionPrefix,
  Plus, Minus,
  Mult, Div,  Pow,
  ResultEqual, Equal,
  ExtensionLiteral,
  Percentage,  
  ExtensionPostfix,
  Annotation,
  NumberLiteral,
  Variable, Identifier, DefinedIdentifier,
  Text, 
  Operator,
]

const lexerOptions = {
  //positionTracking?: "full" | "onlyStart" | "onlyOffset"
  positionTracking: 'full'
}
const TapeLexer = new Lexer(nativeTokens, lexerOptions)

// ----------------- parser -----------------
class TapeParser extends BaseParser {

  _vars = {}
  _varExtensions = {}
  minPad = 1
  
  constructor(tokenVocabulary = nativeTokens, extensionEnabled = false) {
    super(tokenVocabulary, {
      maxLookahead: 2,
      skipValidations: true,
      outputCst: false,
      recoveryEnabled: true,
    })
    this.extensionEnabled = extensionEnabled
    const $ = this

    this.RULE("tape", (objectArgs={decimalDigits: 2, padding: 10})=>{
      this._vars = {}
      this._varExtensions = {}
      let tape = []
      let row
      Object.assign(this, objectArgs)
      
      $.MANY(()=> $.CONSUME(NewLine))
      $.MANY2(()=>{
        row = $.SUBRULE($.rows)
        if(row) tape.push(row) 
      })
      return tape
    })

    this.RULE("rows", ()=>{
      let row
      row = $.OR([
        { ALT: ()=>$.SUBRULE($.assign) },
        /*{ GATE:()=>tokenMatcher($.LA(1), Identifier) && !($.LA(1).image in this._vars),  
          ALT: ()=>{$.SKIP_TOKEN()}
        },*/
        { ALT: ()=>$.SUBRULE($.expression) },
        { ALT: ()=>{$.CONSUME(Text)} },
      ])
      $.MANY(()=>{
        $.CONSUME2(NewLine)
      })
      //$.OR2([{ALT: ()=>$.CONSUME(NewLine)},{ALT: ()=>$.CONSUME(EOF)}])
      return row
    })

    const adapterCall = (method, ...args)=>{
      const adapter = this.extension?.valueAdapter
      if (!adapter || typeof adapter[method] !== "function") {
        throw new TypeError(`extension.valueAdapter.${method} is required`)
      }
      return adapter[method](...args, {
        decimalDigits: this.decimalDigits,
        padding: this.padding,
      })
    }

    const isExtensionValue = (token)=> token?.extensionValue === true
    const toExtensionValue = (token)=> isExtensionValue(token)
      ? token.value
      : adapterCall("fromDecimal", token.value)
    const fixedValue = (token)=> isExtensionValue(token)
      ? String(adapterCall("fixedValue", token.value))
      : token.value.toFixedDecimal()
    const displayValue = (token)=> isExtensionValue(token)
      ? String(adapterCall("formatValue", token.value))
      : token.value.toLocaleString()
    const percentageValue = (value)=> String(adapterCall("formatPercentageValue", value))
    const operatorSymbol = (operator)=>{
      if (operator?.image) return operator.image
      if (tokenMatcher(operator, Plus)) return "+"
      if (tokenMatcher(operator, Minus)) return "-"
      if (tokenMatcher(operator, Mult)) return "×"
      if (tokenMatcher(operator, Div)) return "÷"
      if (tokenMatcher(operator, Pow)) return "^"
      throw new TypeError("unsupported extension operator")
    }

    const format = (tokens, padding)=>{
      return $.ACTION(()=>{
        let lastToken = tokens[tokens.length-1]
        if(lastToken){
          if(tokenMatcher(lastToken, NumberLiteral)){
            const { startColumn, ws, payload } = lastToken
            if(startColumn - ws + payload.decimalPosition > padding) {
              const startOffset = startColumn - ws
              padding = startOffset + payload.decimalPosition + this.minPad
            }
          }
          else if(tokenMatcher(lastToken, ExtensionLiteral)){
            const startOffset = lastToken.startColumn - (lastToken.ws ?? 0)
            const display = lastToken.formatting ?? lastToken.image
            if(startOffset + display.length > padding) {
              padding = startOffset + display.length + this.minPad
            }
          }
          else { //either Identifier or DefinedIdentifier
            const { startColumn, ws } = lastToken
            if(startColumn - ws + lastToken.image.length > padding) {
              const startOffset = startColumn - ws
              padding = startOffset + lastToken.image.length - this.decimalDigits - 1 + this.minPad
            }
          }
        }
        
        //group of token inside expression
        tokens.forEach((token)=>{
          if(!token) return
          if(!tokenMatcher(token, NumberLiteral) && !tokenMatcher(token, ExtensionLiteral)){
            const { startColumn, payload } = token
            const desiredPadding = padding - (startColumn + token.image.length - this.decimalDigits - 1)
            if(token.padding != desiredPadding){
              Object.assign(token, {
                padding: desiredPadding
              })
            }
            return
          }
          //token is now a native or extension literal
          const { startColumn, payload } = token
          const extensionLiteral = tokenMatcher(token, ExtensionLiteral)
          const localeString = extensionLiteral
            ? token.formatting ?? token.image
            : payload.parse.toLocaleString(payload.decimalDigits)
          const localeDecimalPosition = extensionLiteral
            ? localeString.length
            : localeString.length - Math.max(payload.decimalDigits, this.decimalDigits)
          const desiredPadding = padding + this.minPad - (startColumn + localeDecimalPosition)

          if(token.padding != desiredPadding){
            Object.assign(token, {
              padding: desiredPadding
            })
          }

          if(!extensionLiteral && payload.formatted && payload.decimalDigits > this.decimalDigits){ //trim unwanted zeros behind
            if(token.value.canTrimZeros(payload.decimalDigits)){
              Object.assign(token, {
                formatting: payload.parse.toLocaleString()
              })
              return
            }
          }

          if(token.image !== localeString) {
            Object.assign(token, {
              formatting: localeString
            })
          }
        })
        return padding
      })
    }

    const evaluationError = (token, error)=>{
      if(!token) return
      const message = String(error)
      Object.assign(token, {
        style: ['ErrorLiteral', 'Error'],
        tooltip: token.tooltip ? token.tooltip + "\n" + message : message,
      })
    }

    const hasValue = (token)=> token?.value !== undefined

    const applyDescriptorFormatting = (token)=>{
      if(token?.payload?.formatting !== undefined && token.image !== token.payload.formatting) {
        Object.assign(token, {formatting: token.payload.formatting})
      }
    }

    const applyDecorators = (token, prefix, postfix)=>{
      if(!token) {
        evaluationError(prefix ?? postfix, 'Incomplete expression.')
        return token
      }
      for (const [decorator, method, args] of [
        [prefix, "applyPrefix", (value)=>[prefix.payload.value, value]],
        [postfix, "applyPostfix", (value)=>[value, postfix.payload.value]],
      ]) {
        if(!decorator) continue
        applyDescriptorFormatting(decorator)
        const previousValue = token.value
        const previousExtension = token.extensionValue
        try {
          if(decorator.payload.error) throw decorator.payload.error
          const value = toExtensionValue(token)
          token.value = adapterCall(method, ...args(value))
          token.extensionValue = true
        }
        catch(error) {
          token.value = previousValue
          token.extensionValue = previousExtension
          evaluationError(decorator, error)
        }
      }
      return token
    }

    const evaluate = (x, operator, y)=>{
      return $.ACTION(()=>{
        if(!hasValue(x) || !hasValue(y)){
          evaluationError(y ?? operator ?? x, 'Incomplete expression.')
          return x
        }
        const previousValue = x.value
        const previousExtension = x.extensionValue
        try {
          if(isExtensionValue(x) || isExtensionValue(y)) {
            x.value = adapterCall(
              "evaluate",
              toExtensionValue(x),
              operatorSymbol(operator),
              toExtensionValue(y),
            )
            x.extensionValue = true
            return x.value
          }

          if (tokenMatcher(operator, Plus)) {
            return x.value = BigNum.add(x.value, y.value)
          }  

          if (tokenMatcher(operator, Minus)) {
            if(!y.style?.includes("Error")){
              if (tokenMatcher(y, NumberLiteral)) {
                Object.assign(y, {style: ['NegetiveLiteral']})
              }
            }
            return x.value = BigNum.subtract(x.value, y.value)
          }      

          if (tokenMatcher(operator, Mult)) {
            return x.value = BigNum.multiply(x.value, y.value)
          }  
          
          if (tokenMatcher(operator, Div)) {
            try {
              return x.value = BigNum.divideExact(x.value, y.value)
            }
            catch(e){
              return x.value = BigNum.divide(x.value, y.value)
            }
          }

          if (tokenMatcher(operator, Pow)) {
            return x.value = BigNum.power(x.value, y.value)
          }  
          
          throw "Error: This operator is not yet supported"
        }
        catch(e){
          x.value = previousValue
          x.extensionValue = previousExtension
          evaluationError(y ?? operator ?? x, e)
          return x
        }
        
      })
    }
    
    const evaluatePostfix = (x, operator, y, postfix)=>{
      let result
      let _y
      let extensionPercentage = false

      if(!hasValue(x) || !hasValue(y)){
        evaluationError(y ?? operator ?? x, 'Incomplete expression.')
        return x
      }

      result = $.ACTION(()=>{
        const previousValue = x.value
        const previousExtension = x.extensionValue
        try {
          if(isExtensionValue(x) || isExtensionValue(y)) {
            extensionPercentage = true
            _y = adapterCall("percentageOfOne", toExtensionValue(y))
            x.value = adapterCall(
              "evaluatePercentage",
              toExtensionValue(x),
              operatorSymbol(operator),
              _y,
            )
            x.extensionValue = true
            return x.value
          }

          _y = BigNum.divideExact(y.value, BigNum(100.00))
          if (tokenMatcher(operator, Plus)) {
            _y = BigNum.multiply(_y, x.value)
            return x.value = BigNum.add(x.value, _y)
          }  
  
          if (tokenMatcher(operator, Minus)) {
            Object.assign(y, {style: ['NegetiveLiteral']})
            _y = BigNum.multiply(_y, x.value)
            return x.value = BigNum.subtract(x.value, _y)
          }
          
          if (tokenMatcher(operator, Mult)) {
            return x.value = BigNum.multiply(x.value, _y)
          }
          
          if (tokenMatcher(operator, Div)) {
            try {
              return x.value = BigNum.divideExact(x.value, _y)
            }
            catch(e){
              // Preserve QwikTape's QuickJS fallback behavior: when the
              // percentage division is non-terminating, it divides by the
              // original percentage operand rather than its y/100 value.
              return x.value = BigNum.divide(x.value, y.value)
            }
          }

          if (tokenMatcher(operator, Pow)) {
            return x.value = BigNum.power(x.value, _y)
          }

          throw "Error: This operator is not yet supported"
        }
        catch(e){
          x.value = previousValue
          x.extensionValue = previousExtension
          evaluationError(y, e)
          return x
        }
        
      })
      
      if(_y !== undefined) {
        try {
          const { value, seperator } = postfix.payload
          const formattedPercentage = extensionPercentage
            ? percentageValue(_y)
            : BigNum(_y).toFixedDecimal()
          if(value === null || value !== formattedPercentage) {
            Object.assign(postfix, {
              formatting: "%" + seperator + formattedPercentage,
              ws: 0,
              padding: 0,
            })
          }
        }
        catch(error) {
          evaluationError(postfix, error)
        }
      }
      return result
    }
    
    this.RULE("expression", ()=>{
      let lhs, op, rhs, postfix, seperator, aggregate, result
      let depth = 0, tokens = []
      let padding = this.padding
 
      lhs = $.SUBRULE($.atom)
      if(lhs) tokens.push(lhs)
      
      /*$.OPTION({
        GATE: ()=>tokenMatcher(lhs, Identifier) && !lhs.defined,
        DEF: ()=>$.SKIP_TOKEN()
      })*/
      
      $.MANY(()=>{
        $.OR([
          { 
            ALT: ()=>{
              op = $.SUBRULE($.op, {ARGS: [{onNewLine: true}]})
              if(depth==0) {
                padding = format(tokens, padding)
              }
              rhs = $.SUBRULE($.quark)
              postfix = $.SUBRULE($.postfix)
            if(rhs){
              let last = tokens[tokens.length-1]
              if(last?.startLine != rhs.startLine) {
                tokens.push(rhs)
                padding = format(tokens, padding)
              }
            }  
            $.ACTION(()=>{
              if(postfix){
                evaluatePostfix(lhs, op, rhs, postfix)
              }
              else {
                evaluate(lhs, op, rhs)
              }
              if(!hasValue(lhs) || !hasValue(rhs)) return
              depth++
            })
            } 
          },
          { GATE: ()=> depth > 0,
           	ALT: ()=>{
              aggregate = $.SUBRULE($.aggregate, {ARGS: [lhs, padding]})
              if(aggregate){
                tokens.push(aggregate)
                padding = format(tokens, padding)
              }
              depth = 0
          }},
        ])
      })
      
      result = $.OPTION({
        GATE: ()=> depth > 0,
        DEF: ()=>{
          let nl = $.CONSUME(NewLine)
      	  return $.ACTION(()=>{
            let value
            try {
              value = displayValue(lhs)
            }
            catch(error) {
              evaluationError(lhs, error)
              return
            }
            const length = value.length - this.decimalDigits + 1
            if(padding < length){
              padding = length + this.minPad
              padding = format(tokens, padding)
            }
            return {
              type: TokenType.Insert,
              value: value,
              padding: padding + this.decimalDigits,
              node: nl,
            }
          })
        }
      })

      return result
    })
            
    this.RULE("op", (assignment)=>{
      let op, nl

      nl = $.OPTION(()=>$.CONSUME(NewLine))
      op = $.CONSUME(Operator)

      if(!nl && assignment){
        Object.assign(op, assignment)
      }
      return op
    })

    this.RULE("postfix", ()=>{
      let percentage

      $.OPTION(()=>{
        percentage = $.CONSUME(Percentage)
        $.ACTION(()=>{
          const node = {
            startLine: percentage.startLine, startColumn: percentage.startColumn, 
            endLine:   percentage.endLine, endColumn:percentage.endColumn,
          }
          Object.assign(percentage, { type: TokenType.Block, node: node })
        })
      })
      $.OPTION2(()=>{
        $.CONSUME(Annotation)
      })

      return percentage
    })
    
    this.RULE("assign", ()=>{
      let variable, value, result
      variable = $.CONSUME(Variable)
      $.CONSUME(Equal)
      value = $.SUBRULE($.inlineExpression)
      result = $.ACTION(()=>{
        const key = variable.image
        if(!hasValue(value)){
          evaluationError(variable, 'Incomplete assignment.')
          return
        }
        if(key in this._vars){
          Object.assign(variable, {style: ['Error'], tooltip: 'Already defined.'})
        }
        else {
          try {
            this._vars[key] = value.value
            this._varExtensions[key] = isExtensionValue(value)
            Object.assign(variable, {tooltip: fixedValue(value)})
          }
          catch(error) {
            delete this._vars[key]
            delete this._varExtensions[key]
            evaluationError(variable, error)
          }
        }
        //not required in ast
        //return { [key]: value.toString() }
      })
      //return result
    })
    
    this.RULE("inlineExpression", ()=>{
      let exp
      exp =  $.SUBRULE($.sumExpression)
      $.OPTION(()=>$.CONSUME(Annotation))
      return exp
    })

    this.RULE("sumExpression", ()=>{
      let lhs, op, rhs
      lhs = $.SUBRULE($.productExpression)

      $.MANY(()=>{
        op = $.CONSUME(Sums)
        rhs = $.SUBRULE2($.productExpression)
        evaluate(lhs, op, rhs)
      })
      
      return lhs
    })

    this.RULE("productExpression", ()=>{
      let lhs, op, rhs
      lhs = $.SUBRULE($.powerExpression)

      $.MANY(()=>{
        $.OR([
          {
            ALT: ()=>{
              op = $.CONSUME(Products)
              rhs = $.SUBRULE2($.powerExpression)
              evaluate(lhs, op, rhs)
            }
          },
          {
            ALT: ()=>{
              rhs = $.SUBRULE($.parenthesis)
              evaluate(lhs, Mult, rhs)
            }
          }
        ])
      })

      return lhs
    })

    this.RULE("powerExpression", ()=>{
      let lhs, op, rhs
      lhs = $.SUBRULE($.inlineAtom)

      $.MANY(()=>{
        op = $.CONSUME(Pow)
      	rhs = $.SUBRULE2($.inlineAtom)
        evaluate(lhs, op, rhs)
      })

      return lhs
    })

    this.RULE("inlineAtom", ()=>{
      let atom 
      atom = $.OR([
        {ALT:()=>$.SUBRULE($.parenthesis)},
        {ALT:()=>$.SUBRULE($.quark)}
      ])
      return atom
    })

    this.RULE("parenthesis", ()=>{
      let exp, lparen, rparen

      lparen = $.CONSUME(LParen)
      exp = $.SUBRULE($.inlineExpression)
      rparen = $.CONSUME(RParen)
      return $.ACTION(()=>{
        const node = {
          startLine: lparen.startLine, startColumn: lparen.startColumn, 
          endLine:   rparen.endLine,   endColumn:rparen.endColumn,
        }
        Object.assign(lparen, {style: ['ClearMark'], node: rparen})
        Object.assign(rparen, {
          value: exp?.value,
          extensionValue: isExtensionValue(exp),
          node: node,
        })
        return rparen
      })
    })

    this.RULE("aggregate", (lhs, padding)=> {
      let nl, seperator, number, identifier
      //seperator = $.LA(0)
      nl = $.CONSUME(NewLine)
      //$.MANY(()=>$.CONSUME(NewLine))
      seperator = $.CONSUME(Seperator)
      $.CONSUME2(NewLine)      
      number = $.SUBRULE($.factor)

      $.OPTION(()=>{
        $.OR([
          { ALT: ()=>{
            $.CONSUME(ResultEqual)
            identifier = $.CONSUME(SuffixIdentifier)
            $.ACTION(()=>{
              if(!hasValue(number)) return
              const key = identifier.image
              if(key in this._vars){
                Object.assign(identifier, {style: ['Error'], tooltip: 'Already defined.'})
              }
              else {
                try {
                  if(isExtensionValue(lhs) !== isExtensionValue(number) ||
                    fixedValue(lhs) !== fixedValue(number)) {
                    this._vars[key] = lhs.value
                    this._varExtensions[key] = isExtensionValue(lhs)
                  }
                  else{
                    this._vars[key] = number.value
                    this._varExtensions[key] = isExtensionValue(number)
                  }
                }
                catch(error) {
                  evaluationError(identifier, error)
                }
              }
            })
          }},
        ])
      })

      $.OPTION2(()=>$.CONSUME(Annotation))

      return $.ACTION(()=>{
        if(!hasValue(number)) return
        const node = {
          startLine: nl.startLine,     startColumn: nl.startColumn, 
          endLine:   number.endLine,   endColumn:number.endColumn,
        }
        try {
          const lhsDisplay = displayValue(lhs)
          const numberDisplay = displayValue(number)
          //string comparison
          if(lhsDisplay !== numberDisplay){
            Object.assign(number, {
              formatting: lhsDisplay, 
              style: 'Result',
            })
          }
          else {
            if(seperator.endColumn != number.endColumn){
                Object.assign(seperator, {
                formatting: '═'.repeat(number.endColumn),
                padding: -seperator.startColumn,
                ws: seperator.startColumn,
                style: 'Result',
              })
            }
            Object.assign(number, {type: TokenType.Block, style: ['Result'], node: node})
          }
        }
        catch(error) {
          evaluationError(number, error)
        }
        return number
      })
    })
    
    this.RULE("quark", ()=>{
      let prefix, token, postfix
      if(this.extensionEnabled) prefix = $.OPTION(()=>$.CONSUME(ExtensionPrefix))
      token = $.OR([
        { ALT: ()=>$.SUBRULE($.factor) },
        { ALT: ()=>$.SUBRULE($.var) }
      ])
      if(this.extensionEnabled) postfix = $.OPTION2(()=>$.CONSUME(ExtensionPostfix))
      return $.ACTION(()=>applyDecorators(token, prefix, postfix))
    })
    
    this.RULE("atom", ()=>{
      let number, perc
      number = $.SUBRULE($.quark)
      $.OPTION(()=>$.CONSUME(Annotation))      
      return number
    })

    this.RULE("var", ()=>{
      let negetive, identifier
      let lastToken = null, ast = []
      negetive = $.OPTION(()=>$.CONSUME(Minus))
      lastToken = $.LA(0)
      identifier = $.OR([
        { ALT: ()=>$.CONSUME(Identifier) },
        { ALT: ()=>$.CONSUME2(DefinedIdentifier) }
      ])
      return $.ACTION(()=>{
        if(!identifier){
          evaluationError(negetive ?? lastToken, 'Incomplete variable.')
          return identifier
        }
        const key = identifier.image
        let ws = identifier.startColumn

        if(lastToken) {
          let lines = identifier.startLine - lastToken.endLine
          ws = ws - (lines == 0 ? lastToken.endColumn : 0)
        }

        Object.assign(identifier, {
          ws: ws-1,
        })

        if(key in this._vars && this._vars[key] !== undefined){
          const extensionValue = this._varExtensions[key] === true
          const originalValue = this._vars[key]
          try {
            const value = negetive
              ? extensionValue
                ? adapterCall("negate", originalValue)
                : originalValue.negated()
              : originalValue
            Object.assign(identifier, {
              value: value,
              extensionValue,
              defined: true,
              style: negetive ? ['NegetiveLiteral']: [identifier.tokenType.name],
            })
            Object.assign(identifier, {tooltip: fixedValue(identifier)})
          }
          catch(error) {
            Object.assign(identifier, {
              value: originalValue,
              extensionValue,
              defined: true,
            })
            evaluationError(identifier, error)
          }
        }  
        else {
          Object.assign(identifier, {
            value: BigNum(0.00),
            extensionValue: false,
            defined: false,
            style: ['Error'],
            tooltip: 'Undefined variable. Using 0.00 as value.'
          })
        }

        return identifier
      })
    
    })

    this.RULE("factor", ()=>{
      let negetive, number
      let lastToken = null

      negetive = $.OPTION(()=>$.CONSUME(Minus))
      lastToken = $.LA(0)
      number = this.extensionEnabled
        ? $.OR([
          {ALT:()=> $.CONSUME(NumberLiteral)},
          {ALT:()=> $.CONSUME(ExtensionLiteral)},
        ])
        : $.CONSUME(NumberLiteral)
      /*number = $.OR([
        {ALT:()=> $.CONSUME(NumberLiteral)},
        {ALT:()=> $.CONSUME(Infinite)}
      ])*/

      return $.ACTION(()=>{
        if(!number?.payload){
          evaluationError(number ?? negetive ?? lastToken, 'Incomplete number.')
          return
        }
        let ws = number.startColumn
        if(!tokenMatcher(lastToken, EOF)) {
          let lines = number.startLine - lastToken.endLine
          ws = ws - (lines == 0 ? lastToken.endColumn : 0) 
        }
        const extensionLiteral = tokenMatcher(number, ExtensionLiteral)
        try {
          if(extensionLiteral && number.payload.error) throw number.payload.error
          let value = extensionLiteral ? number.payload.value : number.payload.parse
          if(negetive) {
            value = extensionLiteral ? adapterCall("negate", value) : value.negated()
          }
          const negative = extensionLiteral
            ? Boolean(adapterCall("isNegative", value))
            : value.isNegative()
          Object.assign(number, {
            value: value,
            extensionValue: extensionLiteral,
            style: negative ? ['NegetiveLiteral'] : [number.tokenType.name], 
            ws: ws-1,
          })
          if(extensionLiteral) {
            const formatting = number.payload.formatting ?? String(adapterCall("formatLiteral", value))
            if(number.image !== formatting) Object.assign(number, {formatting})
          }
        }
        catch(error) {
          Object.assign(number, {
            value: BigNum(0),
            extensionValue: false,
            ws: ws-1,
          })
          evaluationError(number, error)
        }
        return number
      })
    })

    this.performSelfAnalysis()
  }
  
}

// Keep the native grammar byte-for-byte compatible. Build the extended
// lexer/parser lazily only when calculateTape receives a non-null extension.
const parser = new TapeParser(nativeTokens, false)
let extendedRuntime = null

function selectRuntime(extension) {
  if(!extension) {
    activeExtension = null
    return {lexer: TapeLexer, parser}
  }
  activeExtension = extension
  extensionMatcherDiagnostics = []
  reportedMatcherFailures = new Set()
  if(!extendedRuntime) {
    extendedRuntime = {
      lexer: new Lexer(extensionTokens, lexerOptions),
      parser: new TapeParser(extensionTokens, true),
    }
  }
  return extendedRuntime
}

function changeLocale(format, decimalDigits = 2){
  BigNumEnv.initLocale(format);
  BigNumEnv.setDecimalDigits(decimalDigits);
  regexpNumberLiteral = BigNumEnv.getNumeralMatcher();
}

export const QwikTape = {
  defaultRule: 'tape',
  lexer: TapeLexer,
  parser: parser,
  tokenMatcher: tokenMatcher,
  tokenType: TokenType,
  diagramBuilder: chevrotain.createSyntaxDiagramsCode,
  ERR: {NOALT: chevrotain.NoViableAltException},
  changeLocale: changeLocale,
  selectRuntime,
  clearExtension() {
    activeExtension = null
  },
  extensionDiagnostics() {
    return extensionMatcherDiagnostics.map((diagnostic)=>({...diagnostic}))
  },
}
