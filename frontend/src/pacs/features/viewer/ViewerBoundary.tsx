import { Component, type ReactNode } from "react";

export default class ViewerBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() {
    if(this.state.failed) return <section role="alert" style={{padding:32,background:"#05070a",color:"#d9e4ef",minHeight:240}}><p>The study viewer could not render this image.</p><button onClick={()=>this.setState({failed:false})}>Retry viewer</button><p><a href="/command">Return to the workspace</a></p></section>;
    return this.props.children;
  }
}
